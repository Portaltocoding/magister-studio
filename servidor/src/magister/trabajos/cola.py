"""La cola de trabajos en Postgres: idempotente por clave, con lease y latido.

Coger pone las reservas en fila con un candado de Postgres y usa `FOR UPDATE SKIP LOCKED`: dos trabajadores nunca
cogen el mismo trabajo, dos de la misma lección nunca corren a la vez, los cortos pasan antes y los largos dejan un
hueco libre
(MAGISTER_TRABAJOS_A_LA_VEZ trabajadores por proceso). Un trabajo `en_curso` cuyo lease caducó vuelve a estar
disponible (el trabajador murió).
Cada cambio avisa con `NOTIFY trabajos, '<id>'`.
"""

import hashlib
import json
from datetime import datetime, timedelta, timezone

from sqlalchemy import exists, func, or_, select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import aliased

from magister.config import ajustes
from magister.datos.material import Trabajador, Trabajo
from magister.datos.sesion import nueva_sesion


def ahora() -> datetime:
    return datetime.now(timezone.utc)


def clave_idempotencia(**partes) -> str:
    return hashlib.sha256(json.dumps(partes, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


async def avisar(trabajo_id: int, s=None) -> None:
    if s is not None:
        await s.execute(text("select pg_notify('trabajos', :i)"), {"i": str(trabajo_id)})
        return
    async with nueva_sesion() as s2, s2.begin():
        await s2.execute(text("select pg_notify('trabajos', :i)"), {"i": str(trabajo_id)})


async def encolar(tipo: str, plan_id: int | None, leccion_clave: str | None, parametros: dict, clave: str) -> tuple[int, bool]:
    """Devuelve (id, nuevo). Dos peticiones iguales devuelven el mismo id. Un trabajo fallido o
    cancelado con la misma clave se vuelve a poner en cola."""
    async with nueva_sesion() as s, s.begin():
        r = await s.execute(
            insert(Trabajo).values(tipo=tipo, plan_id=plan_id, leccion_clave=leccion_clave, parametros=parametros, clave=clave)
            .on_conflict_do_nothing(index_elements=["clave"]).returning(Trabajo.id)
        )
        nuevo_id = r.scalar()
        if nuevo_id is not None:
            await avisar(nuevo_id, s)
            return nuevo_id, True
        t = await s.scalar(select(Trabajo).where(Trabajo.clave == clave))
        if t.estado in ("fallido", "cancelado"):
            t.estado, t.intentos, t.error, t.lease_hasta = "pendiente", 0, None, None
            await avisar(t.id, s)
            return t.id, True
        return t.id, False


# Los trabajos cortos (segundos o un minuto): bajar fuentes (8 s), montar un MP4 (23 s), detallar un nivel de un
# proyecto (28 s), un juez, repintar el PDF de unos apuntes, y las diapositivas o el guion de unos apuntes que ya están (sin apuntes ni preguntas).
# Pasan delante de los largos (preparar una lección, 5-20 min; el roadmap de un proyecto con research) y, con varios
# trabajadores, los largos ocupan como mucho `a_la_vez - 1` huecos: siempre queda uno para un corto. Los largos no se
# mueren de hambre: los cortos acaban en segundos y solo llegan cuando los pides.
CORTOS = ("incorporar", "video_mp4", "proyecto_nivel", "juez_online", "repintar")
SOLO_APUNTES = ["apuntes", "preguntas"]  # un trabajo de material con alguno de estos es largo
# La llave del candado de Postgres que pone en fila las reservas (un número cualquiera, fijo).
CANDADO_COGER = 2026111901


def a_la_vez() -> int:
    return max(1, ajustes.trabajos_a_la_vez)


def _corto(t) -> object:
    """1 si el trabajo es corto, 0 si es largo (en SQL, para ordenar y contar). Un material sin «tipos» es largo:
    el trabajador lo toma por unos apuntes."""
    from sqlalchemy import case
    from sqlalchemy.dialects.postgresql import array

    extras = (t.tipo == "material") & ~func.coalesce(t.parametros["tipos"].has_any(array(SOLO_APUNTES)), True)
    return case((t.tipo.in_(CORTOS), 1), (extras, 1), else_=0)


def es_corto(tipo: str, parametros: dict | None) -> bool:
    """Lo mismo que `_corto`, en Python."""
    if tipo in CORTOS:
        return True
    tipos = (parametros or {}).get("tipos")
    return tipo == "material" and tipos is not None and not set(tipos) & set(SOLO_APUNTES)


def _vivo(t) -> object:
    """Un trabajo que de verdad está corriendo: en curso y con el lease al día (si caducó, su trabajador murió)."""
    return (t.estado == "en_curso") & (t.lease_hasta >= ahora())


def _choca(t, o) -> object:
    """Dos trabajos que no pueden correr a la vez: los de la misma lección (escriben en la misma carpeta y en los
    mismos materiales), los «incorporar» entre sí (bajan las mismas URL) y los del mismo proyecto."""
    return or_(
        t.leccion_clave.is_not(None) & (o.plan_id == t.plan_id) & (o.leccion_clave == t.leccion_clave),
        (t.tipo == "incorporar") & (o.tipo == "incorporar"),
        t.parametros["proyecto_id"].astext.is_not(None)
        & (o.parametros["proyecto_id"].astext == t.parametros["proyecto_id"].astext),
    )


async def coger(trabajador: str) -> Trabajo | None:
    """Reserva el primer trabajo disponible que no choque con uno que ya corre: antes los cortos y, entre iguales,
    el más antiguo; si los largos ya ocupan `a_la_vez - 1` huecos, solo un corto.

    Atómico entre trabajadores (de este proceso o de otros): las reservas pasan de una en una por un candado de
    transacción de Postgres (`pg_advisory_xact_lock`), así que cada una ve ya confirmadas las anteriores al comprobar
    qué corre; `FOR UPDATE SKIP LOCKED` sigue por si alguien toca la fila a la vez. Reservar tarda milisegundos:
    ponerlas en fila no frena nada."""
    o = aliased(Trabajo)
    async with nueva_sesion() as s, s.begin():
        await s.execute(select(func.pg_advisory_xact_lock(CANDADO_COGER)))
        disponible = or_(
            (Trabajo.estado == "pendiente") & or_(Trabajo.lease_hasta.is_(None), Trabajo.lease_hasta < ahora()),
            (Trabajo.estado == "en_curso") & (Trabajo.lease_hasta < ahora()),
        )
        sin_choque = ~exists().where(_vivo(o), o.id != Trabajo.id, _choca(Trabajo, o))
        condiciones = [disponible, sin_choque]
        if a_la_vez() > 1:
            largos_vivos = await s.scalar(select(func.count()).select_from(o).where(_vivo(o), _corto(o) == 0))
            if largos_vivos >= a_la_vez() - 1:
                condiciones.append(_corto(Trabajo) == 1)
        t = await s.scalar(
            select(Trabajo).where(*condiciones).order_by(_corto(Trabajo).desc(), Trabajo.id).limit(1)
            .with_for_update(skip_locked=True)
        )
        if t is None:
            return None
        t.estado = "en_curso"
        t.trabajador = trabajador
        t.lease_hasta = ahora() + timedelta(seconds=ajustes.trabajos_lease_s)
        t.empezado_en = t.empezado_en or ahora()
        t.intentos += 1
        await avisar(t.id, s)
        await s.flush()
        s.expunge(t)
        return t


async def latido(trabajador: str, trabajo_id: int | None) -> None:
    async with nueva_sesion() as s, s.begin():
        await s.execute(insert(Trabajador).values(id=trabajador, ultimo_latido=ahora()).on_conflict_do_update(
            index_elements=["id"], set_={"ultimo_latido": ahora()}))
        if trabajo_id is not None:
            await s.execute(update(Trabajo).where(Trabajo.id == trabajo_id, Trabajo.estado == "en_curso").values(
                lease_hasta=ahora() + timedelta(seconds=ajustes.trabajos_lease_s)))


async def fase(trabajo_id: int, nodo: str, paso: int, total: int) -> None:
    async with nueva_sesion() as s, s.begin():
        await s.execute(update(Trabajo).where(Trabajo.id == trabajo_id).values(nodo=nodo, paso=paso, total=total))
        await avisar(trabajo_id, s)


async def aviso(trabajo_id: int, regla: str, detalle: str) -> None:
    async with nueva_sesion() as s, s.begin():
        t = await s.get(Trabajo, trabajo_id)
        t.avisos = [*t.avisos, {"regla": regla, "detalle": detalle}]
        await avisar(trabajo_id, s)


async def cancelado(trabajo_id: int) -> bool:
    async with nueva_sesion() as s:
        return (await s.scalar(select(Trabajo.estado).where(Trabajo.id == trabajo_id))) == "cancelado"


async def terminar(trabajo_id: int, estado: str, error: str | None = None) -> None:
    # Un trabajo cancelado se queda cancelado, aunque la llamada en curso acabe después con un error.
    async with nueva_sesion() as s, s.begin():
        await s.execute(update(Trabajo).where(Trabajo.id == trabajo_id, Trabajo.estado != "cancelado").values(
            estado=estado, error=error, acabado_en=ahora(), lease_hasta=None))
        await avisar(trabajo_id, s)


async def reintentar_luego(trabajo_id: int, espera_s: float, error: str) -> None:
    async with nueva_sesion() as s, s.begin():
        # Solo lo que sigue en curso: un cancelado no vuelve a la cola.
        await s.execute(update(Trabajo).where(Trabajo.id == trabajo_id, Trabajo.estado == "en_curso").values(
            estado="pendiente", error=error, lease_hasta=ahora() + timedelta(seconds=espera_s)))
        await avisar(trabajo_id, s)


async def cancelar(trabajo_id: int) -> bool:
    async with nueva_sesion() as s, s.begin():
        r = await s.execute(update(Trabajo).where(Trabajo.id == trabajo_id, Trabajo.estado.in_(("pendiente", "en_curso")))
                            .values(estado="cancelado", acabado_en=ahora()))
        await avisar(trabajo_id, s)
        return bool(r.rowcount)


async def leer(trabajo_id: int) -> dict | None:
    async with nueva_sesion() as s:
        t = await s.get(Trabajo, trabajo_id)
        if t is None:
            return None
        from magister.datos.material import Material

        mats = (await s.scalars(select(Material.id).where(Material.trabajo_id == trabajo_id))).all()
        en_cola = await _en_cola(s, t) if t.estado == "pendiente" else None
    return {"cola": en_cola,"id": t.id, "tipo": t.tipo, "plan_id": t.plan_id, "leccion_clave": t.leccion_clave, "estado": t.estado,
            "intentos": t.intentos, "nodo": t.nodo, "paso": t.paso, "total": t.total, "avisos": t.avisos, "error": t.error,
            "materiales": list(mats), "creado_en": t.creado_en.isoformat(),
            "acabado_en": t.acabado_en.isoformat() if t.acabado_en else None}


async def _en_cola(s, t: Trabajo) -> dict:
    """Dónde está un trabajo pendiente: cuántos pendientes van antes que él, cuántos corren ahora y en cuántos
    huecos (para que la web diga «En cola: 3 por delante»), y si espera un reintento, desde cuándo puede volver."""
    # En el mismo orden que `coger`: un corto solo tiene delante a los cortos más antiguos; un largo, a todos los
    # cortos pendientes y a los largos más antiguos.
    corto = es_corto(t.tipo, t.parametros)
    antes = (Trabajo.id < t.id) & (_corto(Trabajo) == 1) if corto else or_(_corto(Trabajo) == 1, Trabajo.id < t.id)
    por_delante = await s.scalar(select(func.count()).select_from(Trabajo).where(
        Trabajo.estado == "pendiente", Trabajo.id != t.id, antes))
    en_marcha = await s.scalar(select(func.count()).select_from(Trabajo).where(_vivo(Trabajo)))
    reintento = t.lease_hasta.isoformat() if t.lease_hasta and t.lease_hasta > ahora() else None
    return {"por_delante": int(por_delante or 0), "en_marcha": int(en_marcha or 0), "a_la_vez": a_la_vez(),
            "corto": corto, "reintento_desde": reintento}


async def trabajador_vivo(segundos: int = 90) -> bool:
    async with nueva_sesion() as s:
        ultimo = await s.scalar(select(Trabajador.ultimo_latido).order_by(Trabajador.ultimo_latido.desc()).limit(1))
    return ultimo is not None and (ahora() - ultimo).total_seconds() < segundos
