"""La práctica: qué toca hoy, qué pregunta servir y cómo registrar el intento.

Reglas del contrato: `p_predicha` se escribe al servir; los reintentos no entran en el
programador ni en el modelo; el momento entra como argumento (nada de `now()` aquí dentro).
"""

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


def _prog(c: ConceptoPractica):
    return programador(c.brazo) if c.brazo else programador()


async def cola(ahora: datetime, nuevos_max: int | None = None) -> list[dict]:
    conceptos = await conceptos_practicables()
    estados = await estados_en([c.concepto_id for c in conceptos], ahora)
    fin = fin_del_dia(ahora)
    minutos = await minutos_por_repaso()
    vencidos, nuevos = [], []
    for c in conceptos:
        e = estados[c.concepto_id]
        p = _prog(c)
        prox = p.proxima(e)
        fila = {"concepto_id": c.concepto_id, "plan_id": c.plan_id, "nombre": c.nombre, "leccion_clave": c.leccion_clave,
                "p": round(p.p_recordar(e, ahora), 3), "minutos": minutos, "proxima": prox.isoformat() if prox else None,
                "nuevo": not e.repasos}
        if not e.repasos:
            nuevos.append(fila)
        elif prox is not None and prox <= fin:
            vencidos.append(fila)
    vencidos.sort(key=lambda f: f["p"])
    nuevos.sort(key=lambda f: (f["plan_id"], f["leccion_clave"]))
    return vencidos + nuevos[: ajustes.nuevos_dia if nuevos_max is None else nuevos_max]


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
            "select pregunta_id from intentos where concepto_id = :c and momento >= :d and coalesce(nota_usuario, nota_corrector) = 'fallo'"
        ), {"c": f["concepto_id"], "d": inicio_dia})).all())
        candidatas = [p for p in preguntas if p[0] not in falladas_hoy] or list(preguntas)
        pid, enunciado, opciones = min(candidatas, key=lambda p: (vistas.get(p[0], 0), p[0]))
        brazo = await s.scalar(select(ConceptoFila.brazo).where(ConceptoFila.plan_id == f["plan_id"], ConceptoFila.id == f["concepto_id"]))
        prog = programador(brazo) if brazo else programador()
        s.add(Servida(plan_id=f["plan_id"], concepto_id=f["concepto_id"], pregunta_id=pid, momento=ahora,
                      p_predicha=f["p"], version_programador=prog.version))
        await s.commit()
    return {"pregunta_id": pid, "concepto_id": f["concepto_id"], "plan_id": f["plan_id"], "nombre": f["nombre"],
            "enunciado": enunciado, "p": f["p"], "quedan": len(pendientes),
            "opciones": [o["texto"] for o in opciones] if opciones else None}


async def contexto_pregunta(pregunta_id: str) -> tuple[str, str, list[str]]:
    """Enunciado, referencia (la fantasma) y los fragmentos de apoyo de su lección."""
    async with nueva_sesion() as s:
        p = await s.get(Pregunta, pregunta_id)
        frag = (await s.scalars(text(
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
