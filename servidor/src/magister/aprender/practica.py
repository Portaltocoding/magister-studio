"""La práctica: qué toca hoy, qué pregunta servir y cómo registrar el intento.

Reglas del contrato: `p_predicha` se escribe al servir; los reintentos no entran en el
programador ni en el modelo; el momento entra como argumento (nada de `now()` aquí dentro).
"""

import asyncio
import statistics
from dataclasses import dataclass
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select, text

from magister.aprender.estado import EstadoConcepto, estados_en
from magister.aprender.programador import programador
from magister.config import ajustes
from magister.datos.aprender import Intento, Servida
from magister.datos.material import Pregunta, PreguntaConcepto
from magister.datos.plan import ConceptoFila, PlanFila
from magister.datos.sesion import nueva_sesion

MINUTOS_POR_DEFECTO = 2.0


def fin_del_dia(ahora: datetime) -> datetime:
    """El día de estudio acaba a `MAGISTER_INICIO_DIA` del día siguiente, en `MAGISTER_ZONA`."""
    zona = ZoneInfo(ajustes.zona)
    local = ahora.astimezone(zona)
    h, m = (int(x) for x in ajustes.inicio_dia.split(":"))
    corte = datetime.combine(local.date(), time(h, m), zona)
    return corte if local < corte else corte + timedelta(days=1)


@dataclass
class ConceptoPractica:
    plan_id: int
    concepto_id: str
    nombre: str
    leccion_clave: str
    brazo: str | None


async def conceptos_practicables() -> list[ConceptoPractica]:
    """Conceptos de planes aceptados que ya tienen preguntas activas (material generado)."""
    async with nueva_sesion() as s:
        filas = (await s.execute(
            select(ConceptoFila.plan_id, ConceptoFila.id, ConceptoFila.nombre, ConceptoFila.leccion_clave, ConceptoFila.brazo)
            .join(PlanFila, PlanFila.id == ConceptoFila.plan_id)
            .where(PlanFila.estado == "aceptado", ConceptoFila.aprobado.is_(True))
            .where(select(PreguntaConcepto.pregunta_id).join(Pregunta, Pregunta.id == PreguntaConcepto.pregunta_id)
                   .where(PreguntaConcepto.plan_id == ConceptoFila.plan_id, PreguntaConcepto.concepto_id == ConceptoFila.id,
                          Pregunta.estado == "activa", Pregunta.sonda.is_(False)).exists())
        )).all()
    return [ConceptoPractica(*f) for f in filas]


async def minutos_por_repaso() -> float:
    """La mediana de tus latencias, en minutos (más la corrección, que va dentro de la latencia del flujo)."""
    async with nueva_sesion() as s:
        lat = (await s.scalars(select(Intento.latencia_ms).where(Intento.latencia_ms.is_not(None))
                               .order_by(Intento.momento.desc()).limit(200))).all()
    return round(statistics.median(lat) / 60000 + 0.5, 1) if len(lat) >= 5 else MINUTOS_POR_DEFECTO


async def lecciones_empezadas() -> set[tuple[int, str]]:
    """(plan, lección) con alguna sesión hecha."""
    from magister.datos.plan import SesionFila

    async with nueva_sesion() as s:
        filas = (await s.execute(select(SesionFila.plan_id, SesionFila.leccion_clave).where(SesionFila.estado == "hecha").distinct())).all()
    return {(a, b) for a, b in filas}


def _prog(c: ConceptoPractica):
    return programador(c.brazo) if c.brazo else programador()


async def cola(ahora: datetime, nuevos_max: int | None = None) -> list[dict]:
    conceptos = await conceptos_practicables()
    # Lecturas independientes entre sí: van a la vez, cada una con su conexión (antes, una detrás de otra).
    estados, minutos, empezadas, bloquea, otra_vez = await asyncio.gather(
        estados_en([c.concepto_id for c in conceptos], ahora), minutos_por_repaso(), lecciones_empezadas(),
        _cuantos_bloquea(), _a_repetir_hoy(ahora))
    fin = fin_del_dia(ahora)
    vencidos, nuevos = [], []
    # Un concepto nuevo entra en el repaso solo si ya empezaste su lección (una sesión hecha o algo practicado):
    # no tiene sentido repasar lo que aún no has estudiado.
    empezadas |={(c.plan_id, c.leccion_clave) for c in conceptos if estados[c.concepto_id].repasos}
    for c in conceptos:
        e = estados[c.concepto_id]
        if not e.repasos and (c.plan_id, c.leccion_clave) not in empezadas:
            continue
        p = _prog(c)
        prox = p.proxima(e)
        fila = {"concepto_id": c.concepto_id, "plan_id": c.plan_id, "nombre": c.nombre, "leccion_clave": c.leccion_clave,
                "p": round(p.p_recordar(e, ahora), 3), "minutos": minutos, "proxima": prox.isoformat() if prox else None,
                "nuevo": not e.repasos}
        if not e.repasos:
            nuevos.append(fila)
        elif prox is not None and prox <= fin:
            vencidos.append(fila)
    # Orden (engram docs/13 §2.2): con tiempo limitado, primero lo que aún se salva barato (p alta, cerca del umbral);
    # lo casi olvidado (p < 0,10) al final, como «a reaprender»: esperar no le quita casi nada más. A igualdad,
    # antes lo que bloquea a otros conceptos tuyos (idea de learn-anything: los requisitos primero).
    vencidos.sort(key=lambda f: (f["p"] < CASI_OLVIDADO, -f["p"] - 0.02 * bloquea.get((f["plan_id"], f["concepto_id"]), 0)))
    for f in vencidos:
        f["reaprender"] = f["p"] < CASI_OLVIDADO
    nuevos.sort(key=lambda f: (f["plan_id"], f["leccion_clave"]))
    # Reaprendizaje en la misma sesión (Rawson y Dunlosky): lo que fallas hoy vuelve al final de la tanda, con otra
    # pregunta, hasta acertarlo una vez (como mucho 3 intentos al día). Esos reintentos no cuentan para el programador.
    ya ={(f["plan_id"], f["concepto_id"]) for f in vencidos}
    por_id = {(c.plan_id, c.concepto_id): c for c in conceptos}
    repetir = []
    for clave in otra_vez:
        c = por_id.get(clave)
        if c is None:
            continue
        if clave in ya:
            vencidos = [f for f in vencidos if (f["plan_id"], f["concepto_id"]) != clave]
        e = estados[c.concepto_id]
        repetir.append({"concepto_id": c.concepto_id, "plan_id": c.plan_id, "nombre": c.nombre, "leccion_clave": c.leccion_clave,
                        "p": round(_prog(c).p_recordar(e, ahora), 3), "minutos": minutos, "proxima": None, "nuevo": False,
                        "otra_vez": True})
    return vencidos + nuevos[: ajustes.nuevos_dia if nuevos_max is None else nuevos_max] + repetir


CASI_OLVIDADO = 0.10
INTENTOS_AL_DIA = 3


async def _cuantos_bloquea() -> dict[tuple[int, str], int]:
    """Cuántos conceptos dependen de cada uno."""
    async with nueva_sesion() as s:
        filas = (await s.execute(text(
            "select plan_id, unnest(depende_de) as base, count(*) from conceptos group by 1, 2"))).all()
    return {(p, b): n for p, b, n in filas}


async def _a_repetir_hoy(ahora: datetime) -> list[tuple[int, str]]:
    """Conceptos cuyo primer intento de hoy fue un fallo, sin acierto después con otra pregunta y con menos de 3
    intentos hoy."""
    inicio = fin_del_dia(ahora) - timedelta(days=1)
    async with nueva_sesion() as s:
        filas = (await s.execute(text(
            "select plan_id, concepto_id, pregunta_id, coalesce(nota_usuario, nota_corrector) from intentos "
            "where momento >= :d order by plan_id, concepto_id, momento"), {"d": inicio})).all()
        claves = {(f[0], f[1]) for f in filas}
        preguntas: dict[tuple[int, str], set[str]] = {k: set() for k in claves}
        if claves:
            for plan_id, cid, pid in (await s.execute(
                select(PreguntaConcepto.plan_id, PreguntaConcepto.concepto_id, Pregunta.id)
                .join(Pregunta, Pregunta.id == PreguntaConcepto.pregunta_id)
                .where(PreguntaConcepto.concepto_id.in_({c for _, c in claves}), Pregunta.estado == "activa",
                       Pregunta.sonda.is_(False)))).all():
                if (plan_id, cid) in preguntas:
                    preguntas[(plan_id, cid)].add(pid)
    return por_repetir([tuple(f) for f in filas], preguntas)


def por_repetir(filas: list[tuple[int, str, str, str]], preguntas: dict[tuple[int, str], set[str]] | None = None
                ) -> list[tuple[int, str]]:
    """`filas`: (plan, concepto, pregunta, nota) de hoy, en orden. Acertar una pregunta que ya fallaste hoy (por
    ejemplo, copiando la explicación) no saca al concepto del reaprendizaje: hace falta acertar otra.

    `preguntas`: las activas de cada concepto. Si no queda ninguna sin fallar hoy (el concepto tiene una sola), no
    hay otra que acertar: acertar la misma después del fallo lo da por recuperado."""
    from magister.aprender.estado import es_acierto

    por: dict[tuple[int, str], list[tuple[str, str]]] = {}
    for plan_id, cid, pid, nota in filas:
        por.setdefault((plan_id, cid), []).append((pid, nota))
    salida = []
    for k, lista in por.items():
        falladas = {pid for pid, nota in lista if not es_acierto(nota)}
        if es_acierto(lista[0][1]) or len(lista) >= INTENTOS_AL_DIA:
            continue
        sin_otra = preguntas is not None and not (preguntas.get(k, set()) - falladas)
        if not any(es_acierto(nota) and (sin_otra or pid not in falladas) for pid, nota in lista):
            salida.append(k)
    return salida


async def siguiente(ahora: datetime, concepto_id: str | None = None) -> dict | None:
    """Elige la pregunta del concepto que más urge, la menos vista y no fallada hoy, y apuesta p."""
    pendientes = await cola(ahora)
    if concepto_id:
        pendientes = [f for f in pendientes if f["concepto_id"] == concepto_id] or pendientes
    if not pendientes:
        return None
    f = pendientes[0]
    inicio_dia = fin_del_dia(ahora) - timedelta(days=1)
    async with nueva_sesion() as s:
        preguntas = (await s.execute(
            select(Pregunta.id, Pregunta.enunciado, Pregunta.opciones).join(PreguntaConcepto, PreguntaConcepto.pregunta_id == Pregunta.id)
            .where(PreguntaConcepto.plan_id == f["plan_id"], PreguntaConcepto.concepto_id == f["concepto_id"],
                   Pregunta.estado == "activa", Pregunta.sonda.is_(False))
        )).all()
        vistas = dict((await s.execute(text(
            "select pregunta_id, count(*) from intentos where concepto_id = :c group by 1"), {"c": f["concepto_id"]})).all())
        falladas_hoy = set((await s.scalars(text(
            # Como en `por_repetir`: un «parcial» también es fallarla.
            "select pregunta_id from intentos where concepto_id = :c and momento >= :d "
            "and coalesce(nota_usuario, nota_corrector) not in ('bien', 'perfecta')"
        ), {"c": f["concepto_id"], "d": inicio_dia})).all())
        sin_fallar = [p for p in preguntas if p[0] not in falladas_hoy]
        candidatas = sin_fallar or list(preguntas)
        pid, enunciado, opciones = min(candidatas, key=lambda p: (vistas.get(p[0], 0), p[0]))
        brazo = await s.scalar(select(ConceptoFila.brazo).where(ConceptoFila.plan_id == f["plan_id"], ConceptoFila.id == f["concepto_id"]))
        prog = programador(brazo) if brazo else programador()
        s.add(Servida(plan_id=f["plan_id"], concepto_id=f["concepto_id"], pregunta_id=pid, momento=ahora,
                      p_predicha=f["p"], version_programador=prog.version))
        # El repaso es de todos tus planes a la vez (como el estado de un concepto): cada pregunta dice de cuál es.
        donde = (await s.execute(text(
            "select t.nombre, l.titulo from planes p join temas t on t.id = p.tema_id "
            "left join lecciones l on l.plan_id = p.id and l.clave = :c where p.id = :p"),
            {"p": f["plan_id"], "c": f["leccion_clave"]})).first()
        await s.commit()
    return {"pregunta_id": pid, "concepto_id": f["concepto_id"], "plan_id": f["plan_id"], "nombre": f["nombre"],
            "enunciado": enunciado, "p": f["p"], "quedan": len(pendientes), "otra_vez": bool(f.get("otra_vez")),
            # Si no queda otra pregunta sin fallar hoy, la vuelta es con la misma: la interfaz no promete «otra».
            "otra_pregunta": bool(sin_fallar),
            "tema": donde[0] if donde else None, "leccion_clave": f["leccion_clave"],
            "leccion_titulo": donde[1] if donde else None,
            "opciones": [o["texto"] for o in opciones] if opciones else None}


def primero_del_dia(momento: datetime, anteriores: list[datetime]) -> bool:
    """Si un intento espaciado es el repaso de su día: ningún otro espaciado del mismo concepto antes, ese día de
    estudio. Es lo único que cuenta para el programador (`estado_de`)."""
    from magister.aprender.estado import dia_de_estudio

    dia = dia_de_estudio(momento)
    return not any(m < momento and dia_de_estudio(m) == dia for m in anteriores)


async def cuenta_para_el_repaso(intento: Intento) -> bool:
    """Si cambiar la nota de este intento cambia algo del programador: solo si es el primer espaciado del día."""
    if intento.tipo != "espaciado":
        return False
    async with nueva_sesion() as s:
        antes = (await s.scalars(select(Intento.momento).where(
            Intento.concepto_id == intento.concepto_id, Intento.tipo == "espaciado", Intento.momento < intento.momento,
            Intento.momento > intento.momento - timedelta(days=2)))).all()
    return primero_del_dia(intento.momento, list(antes))


async def ultimo_intento(desde: datetime) -> dict | None:
    """El último intento corregido en Repaso desde `desde` (sin tests, fichas ni exámenes), con su corrección y su
    explicación: lo que la interfaz enseña si recargaste mientras se corregía."""
    async with nueva_sesion() as s:
        fila = (await s.execute(
            select(Intento, Pregunta.enunciado, ConceptoFila.nombre)
            .join(Pregunta, Pregunta.id == Intento.pregunta_id, isouter=True)
            .join(ConceptoFila, (ConceptoFila.plan_id == Intento.plan_id) & (ConceptoFila.id == Intento.concepto_id), isouter=True)
            .where(Intento.momento >= desde, Intento.version_corrector.not_in(["test", "ficha"]),
                   Intento.clave_idempotencia.not_like("examen-%"))
            .order_by(Intento.momento.desc()).limit(1))).first()
    if fila is None:
        return None
    i, enunciado, nombre = fila
    c = i.correccion or {}
    return {"intento_id": str(i.id), "pregunta_id": i.pregunta_id, "concepto_id": i.concepto_id, "nombre": nombre,
            "enunciado": enunciado, "respuesta": i.respuesta, "momento": i.momento.isoformat(), "tipo": i.tipo,
            "nota": i.nota_corrector, "nota_usuario": i.nota_usuario, "ideas_ausentes": c.get("ideas_ausentes", []),
            "errores": c.get("errores", []), "explicacion": i.explicacion or ""}


async def contexto_pregunta(pregunta_id: str) -> tuple[str, str, list[str]]:
    """Enunciado, referencia (la fantasma) y los fragmentos de apoyo de su lección."""
    async with nueva_sesion() as s:
        p = await s.get(Pregunta, pregunta_id)
        if p is None:
            raise LookupError("esa pregunta ya no existe")
        frag =(await s.scalars(text(
            "select f.texto from lecciones_fragmentos lf join fragmentos f on f.id = lf.fragmento_id "
            "where lf.plan_id = :p and lf.leccion_clave = :c order by lf.rango limit 5"), {"p": p.plan_id, "c": p.leccion_clave})).all()
    return p.enunciado, p.fantasma, list(frag)


async def ultima_servida(pregunta_id: str) -> Servida | None:
    async with nueva_sesion() as s:
        return await s.scalar(select(Servida).where(Servida.pregunta_id == pregunta_id).order_by(Servida.id.desc()).limit(1))


async def estado_y_programador(plan_id: int, concepto_id: str, ahora: datetime) -> tuple[EstadoConcepto, object]:
    async with nueva_sesion() as s:
        brazo = await s.scalar(select(ConceptoFila.brazo).where(ConceptoFila.plan_id == plan_id, ConceptoFila.id == concepto_id))
    estado = (await estados_en([concepto_id], ahora))[concepto_id]
    return estado, (programador(brazo) if brazo else programador())
