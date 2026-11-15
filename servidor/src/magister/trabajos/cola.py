"""La cola de trabajos en Postgres: idempotente por clave, con lease y latido.

Coger usa `FOR UPDATE SKIP LOCKED`: dos trabajadores nunca cogen el mismo trabajo. Un
trabajo `en_curso` cuyo lease caducó vuelve a estar disponible (el trabajador murió).
Cada cambio avisa con `NOTIFY trabajos, '<id>'`.
"""

import hashlib
import json
from datetime import datetime, timedelta, timezone

from sqlalchemy import or_, select, text, update
from sqlalchemy.dialects.postgresql import insert

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


async def coger(trabajador: str) -> Trabajo | None:
    async with nueva_sesion() as s, s.begin():
        t = await s.scalar(
            select(Trabajo)
            .where(or_(
                (Trabajo.estado == "pendiente") & or_(Trabajo.lease_hasta.is_(None), Trabajo.lease_hasta < ahora()),
                (Trabajo.estado == "en_curso") & (Trabajo.lease_hasta < ahora()),
            ))
            .order_by(Trabajo.id).limit(1).with_for_update(skip_locked=True)
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
    async with nueva_sesion() as s, s.begin():
        await s.execute(update(Trabajo).where(Trabajo.id == trabajo_id).values(
            estado=estado, error=error, acabado_en=ahora(), lease_hasta=None))
        await avisar(trabajo_id, s)


async def reintentar_luego(trabajo_id: int, espera_s: float, error: str) -> None:
    async with nueva_sesion() as s, s.begin():
        await s.execute(update(Trabajo).where(Trabajo.id == trabajo_id).values(
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
    return {"id": t.id, "tipo": t.tipo, "plan_id": t.plan_id, "leccion_clave": t.leccion_clave, "estado": t.estado,
            "intentos": t.intentos, "nodo": t.nodo, "paso": t.paso, "total": t.total, "avisos": t.avisos, "error": t.error,
            "materiales": list(mats), "creado_en": t.creado_en.isoformat(),
            "acabado_en": t.acabado_en.isoformat() if t.acabado_en else None}


async def trabajador_vivo(segundos: int = 90) -> bool:
    async with nueva_sesion() as s:
        ultimo = await s.scalar(select(Trabajador.ultimo_latido).order_by(Trabajador.ultimo_latido.desc()).limit(1))
    return ultimo is not None and (ahora() - ultimo).total_seconds() < segundos
