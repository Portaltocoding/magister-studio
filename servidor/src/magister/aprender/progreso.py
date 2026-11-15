"""El progreso: estado de cada concepto, calibración, racha y tiempo. Todo se calcula al pedirlo."""

from datetime import datetime, timedelta

from sqlalchemy import select, text

from magister.aprender.estado import es_acierto, estados_en
from magister.aprender.programador import programador
from magister.datos.aprender import Intento
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
        return (await s.get(Pregunta, pregunta_id)).plan_id


async def conceptos(ahora: datetime) -> list[dict]:
    async with nueva_sesion() as s:
        filas = (await s.execute(
            select(ConceptoFila.plan_id, ConceptoFila.id, ConceptoFila.nombre, ConceptoFila.leccion_clave, ConceptoFila.brazo)
            .join(PlanFila, PlanFila.id == ConceptoFila.plan_id).where(PlanFila.estado == "aceptado")
            .order_by(ConceptoFila.plan_id, ConceptoFila.leccion_clave)
        )).all()
        deps = (await s.execute(select(DependenciaFila.plan_id, DependenciaFila.leccion_clave, DependenciaFila.depende_de))).all()
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
        })
    return salida


async def calibracion(fuente: str, desde: datetime) -> list[dict]:
    """Tramos de 0,1: lo que apostabas (tu confianza o la p del modelo) frente a lo que acertaste."""
    columna = "confianza" if fuente == "usuario" else "p_predicha"
    async with nueva_sesion() as s:
        filas = (await s.execute(text(
            f"select {columna}, coalesce(nota_usuario, nota_corrector) from intentos "
            f"where tipo = 'espaciado' and momento >= :d and {columna} is not null"), {"d": desde})).all()
    tramos: dict[int, list[tuple[float, int]]] = {}
    for p, nota in filas:
        tramos.setdefault(min(9, int(p * 10)), []).append((p, int(es_acierto(nota))))
    return [{"predicho": round(sum(p for p, _ in v) / len(v), 3), "observado": round(sum(y for _, y in v) / len(v), 3), "n": len(v)}
            for _, v in sorted(tramos.items())]


async def resumen(ahora: datetime) -> dict:
    """Porcentaje del camino (sesiones hechas), dominio, días estudiados, racha y tiempo."""
    async with nueva_sesion() as s:
        dias = [d for (d,) in (await s.execute(text(
            "select distinct (momento at time zone 'Europe/Madrid')::date from intentos order by 1 desc"))).all()]
        minutos = (await s.scalar(text("select coalesce(sum(latencia_ms), 0) / 60000.0 from intentos"))) or 0
        sesiones = (await s.execute(text(
            "select coalesce(sum(s.horas) filter (where s.estado = 'hecha'), 0), coalesce(sum(s.horas), 0) "
            "from sesiones s join planes p on p.id = s.plan_id where p.estado = 'aceptado'"))).one()
        intentos = await s.scalar(select(text("count(*)")).select_from(Intento))
    racha = 0
    hoy = ahora.date()
    for i, d in enumerate(dias):
        if d == hoy - timedelta(days=i) or (i == 0 and d == hoy - timedelta(days=1)):
            racha += 1
        else:
            break
    lista = await conceptos(ahora)
    dominados = sum(1 for c in lista if c["estado"] == "dominado")
    return {"camino": round(sesiones[0] / sesiones[1], 3) if sesiones[1] else 0.0, "horas_hechas": float(sesiones[0]),
            "horas_plan": float(sesiones[1]), "conceptos": len(lista), "dominados": dominados,
            "dias_estudiados": len(dias), "racha": racha, "minutos_practica": round(float(minutos)), "intentos": intentos}
