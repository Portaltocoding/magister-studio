"""El progreso: estado de cada concepto, calibración, racha y tiempo. Todo se calcula al pedirlo."""

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select, text

from magister.aprender.estado import es_acierto, estados_en
from magister.aprender.programador import programador
from magister.config import ajustes
from magister.datos.material import Pregunta
from magister.datos.plan import ConceptoFila, DependenciaFila, PlanFila
from magister.datos.sesion import nueva_sesion

UMBRAL_DOMINADO = 0.9


def etiqueta(p: float, vistas: int, ultimo_acierto: bool) -> str:
    if vistas == 0:
        return "nuevo"
    if p >= UMBRAL_DOMINADO and vistas >= 3 and ultimo_acierto:
        return "dominado"
    if p >= 0.7:
        return "aprendiendo"
    return "flojo"


async def plan_de_pregunta(pregunta_id: str) -> int:
    async with nueva_sesion() as s:
        p = await s.get(Pregunta, pregunta_id)
    if p is None:
        raise LookupError("esa pregunta ya no existe")
    return p.plan_id


async def conceptos(ahora: datetime) -> list[dict]:
    async with nueva_sesion() as s:
        filas = (await s.execute(
            select(ConceptoFila.plan_id, ConceptoFila.id, ConceptoFila.nombre, ConceptoFila.leccion_clave, ConceptoFila.brazo)
            .join(PlanFila, PlanFila.id == ConceptoFila.plan_id).where(PlanFila.estado == "aceptado")
            .order_by(ConceptoFila.plan_id, ConceptoFila.leccion_clave)
        )).all()
        deps = (await s.execute(select(DependenciaFila.plan_id, DependenciaFila.leccion_clave, DependenciaFila.depende_de))).all()
        # Cuántas preguntas activas tiene cada concepto: con 0 nunca entra en el repaso y con 1 la vuelta de un
        # fallo repite la misma. La generación del material no obliga a cubrir los conceptos de ampliación; aquí se dice.
        n_preguntas = {(p, c): n for p, c, n in (await s.execute(text(
            "select pc.plan_id, pc.concepto_id, count(*) from preguntas_concepto pc join preguntas p on p.id = pc.pregunta_id "
            "where p.estado = 'activa' and not p.sonda group by 1, 2"))).all()}
    estados = await estados_en([f[1] for f in filas], ahora)
    salida = []
    for plan_id, cid, nombre, leccion, brazo in filas:
        e = estados[cid]
        prog = programador(brazo) if brazo else programador()
        p = prog.p_recordar(e, ahora)
        prox = prog.proxima(e)
        salida.append({
            "plan_id": plan_id, "concepto_id": cid, "nombre": nombre, "leccion_clave": leccion, "p": round(p, 3),
            "estado": etiqueta(p, e.vistas, bool(e.repasos) and es_acierto(e.repasos[-1][1])),
            "aciertos": e.aciertos, "fallos": e.fallos, "proxima": prox.isoformat() if prox else None,
            "repasos": [{"momento": m.isoformat(), "nota": n} for m, n in e.repasos],
            "lecciones_previas": [d for p_, lec, d in deps if p_ == plan_id and lec == leccion],
            "preguntas": n_preguntas.get((plan_id, cid), 0),
        })
    return salida


async def calibracion(fuente: str, desde: datetime, plan_id: int | None = None) -> list[dict]:
    """Tramos de 0,1: lo que apostabas (tu confianza o la p del modelo) frente a lo que acertaste. Con `plan_id`,
    solo las respuestas de ese plan."""
    columna = "confianza" if fuente == "usuario" else "p_predicha"
    async with nueva_sesion() as s:
        filas = (await s.execute(text(
            f"select {columna}, coalesce(nota_usuario, nota_corrector) from intentos "
            f"where tipo = 'espaciado' and momento >= :d and {columna} is not null "
            "and (cast(:p as bigint) is null or plan_id = :p)"), {"d": desde, "p": plan_id})).all()
    tramos: dict[int, list[tuple[float, int]]] = {}
    for p, nota in filas:
        tramos.setdefault(min(9, int(p * 10)), []).append((p, int(es_acierto(nota))))
    return [{"predicho": round(sum(p for p, _ in v) / len(v), 3), "observado": round(sum(y for _, y in v) / len(v), 3), "n": len(v)}
            for _, v in sorted(tramos.items())]


def racha(dias: list[date], ahora: datetime) -> int:
    """Días seguidos estudiando, de `dias` (fechas locales, de más reciente a más antigua). Hoy es el día en
    `MAGISTER_ZONA`, no en UTC; si hoy aún no has estudiado, la racha sigue viva desde ayer."""
    hoy = ahora.astimezone(ZoneInfo(ajustes.zona)).date()
    base = hoy if dias and dias[0] == hoy else hoy - timedelta(days=1)
    n = 0
    for i, d in enumerate(dias):
        if d != base - timedelta(days=i):
            break
        n += 1
    return n


async def resumen(ahora: datetime, plan_id: int | None = None) -> dict:
    """Porcentaje del camino (sesiones hechas), dominio, días estudiados, racha y tiempo.

    Con `plan_id`, todo es de ese plan (sesiones, conceptos, respuestas, minutos y días) menos la racha, que es de
    todos tus planes por naturaleza: un día estudiando otra cosa no la rompe (`racha_global`)."""
    filtro = "(cast(:p as bigint) is null or plan_id = :p)"
    async with nueva_sesion() as s:
        todos = [d for (d,) in (await s.execute(text(
            "select distinct (momento at time zone :zona)::date from intentos order by 1 desc"), {"zona": ajustes.zona})).all()]
        dias = [d for (d,) in (await s.execute(text(
            f"select distinct (momento at time zone :zona)::date from intentos where {filtro} order by 1 desc"),
            {"zona": ajustes.zona, "p": plan_id})).all()]
        minutos = (await s.scalar(text(f"select coalesce(sum(latencia_ms), 0) / 60000.0 from intentos where {filtro}"),
                                  {"p": plan_id})) or 0
        sesiones = (await s.execute(text(
            "select coalesce(sum(s.horas) filter (where s.estado = 'hecha'), 0), coalesce(sum(s.horas), 0) "
            "from sesiones s join planes p on p.id = s.plan_id where p.estado = 'aceptado' "
            "and (cast(:p as bigint) is null or s.plan_id = :p)"), {"p": plan_id})).one()
        intentos = await s.scalar(text(f"select count(*) from intentos where {filtro}"), {"p": plan_id})
    lista = [c for c in await conceptos(ahora) if plan_id is None or c["plan_id"] == plan_id]
    dominados = sum(1 for c in lista if c["estado"] == "dominado")
    return {"camino": round(sesiones[0] / sesiones[1], 3) if sesiones[1] else 0.0, "horas_hechas": float(sesiones[0]),
            "horas_plan": float(sesiones[1]), "conceptos": len(lista), "dominados": dominados,
            "dias_estudiados": len(dias), "racha": racha(todos, ahora), "racha_global": True,
            "minutos_practica": round(float(minutos)), "intentos": intentos, "plan_id": plan_id}
