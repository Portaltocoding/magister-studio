"""El plan aceptado tal como lo pinta la interfaz, y el recálculo tras un atraso."""

from collections import defaultdict
from datetime import date, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession

from magister.config import ajustes
from magister.datos import plan as dp
from magister.datos import repositorio_fuentes as rf
from magister.flujo.nodos.calendarizar import reglas_calendario
from magister.plan.apoyo import estado_apuntes
from magister.plan.calendario import NoCabe, a_hora, calendarizar
from magister.plan.esquemas import Concepto, Leccion, Perfil, Plan
from magister.plan.examenes import con_estado, hitos

ESTADO_RESEARCH = {"en_curso": "buscando", "acabada": "acabada", "cortada": "cortada"}


def biblioteca_de_leccion(objetivos: list[str], fuentes: list[dict], tarea: dict | None) -> dict:
    """La pequeña biblioteca de una lección: sus fuentes, los objetivos (desde 1) sin fuente y cómo va la búsqueda.
    Si alguna fuente trae la ficha del juez, lo que falta sale de ahí; si no, de lo que anotó la última búsqueda."""
    # Cubre lo que ya está en tus fuentes (lista o indexándose); lo que falló o aún no ha entrado, no.
    vivas = [f for f in fuentes if f["estado"] in ("lista", "indexando")]
    con_ficha = any(f.get("tipo") or f.get("cubre") for f in fuentes)
    anotado = (tarea or {}).get("sin_cubrir")
    if con_ficha:
        cubiertos = {i for f in vivas for i in f.get("cubre") or []}
        sin_fuente = [i for i in range(1, len(objetivos) + 1) if i not in cubiertos]
    else:
        sin_fuente = [i for i in anotado or [] if 1 <= i <= len(objetivos)]
    research = ESTADO_RESEARCH.get((tarea or {}).get("estado", ""), "sin_lanzar")
    # Sin ficha ni anotación (las propuestas y búsquedas de antes), no se sabe qué objetivos cubre cada fuente.
    return {"fuentes": fuentes, "sin_fuente": sin_fuente, "research": research,
            "cobertura_conocida": con_ficha or anotado is not None}


async def examenes_del_plan(s: AsyncSession, plan_id: int, lecs: list, ses: list) -> list[dict]:
    """Los exámenes que tocan según el calendario, marcados si ya hiciste uno que los cubre."""
    from sqlalchemy import select

    from magister.datos.aprender import Examen

    ultima: dict = {}
    for x in ses:
        ultima[x.leccion_clave] = max(ultima.get(x.leccion_clave, x.fecha), x.fecha)
    hechos = [(set(e.lecciones or []), e.nota) for e in (await s.scalars(
        select(Examen).where(Examen.plan_id == plan_id, Examen.terminado.is_not(None)))).all()]
    return con_estado(hitos([lec.clave for lec in lecs], ultima), hechos)


async def _plan_pydantic(s: AsyncSession, plan_id: int) -> Plan:
    lecs = await dp.lecciones(s, plan_id)
    cons = await dp.conceptos(s, plan_id)
    deps = await dp.dependencias(s, plan_id)
    por_leccion = defaultdict(list)
    for c in cons:
        por_leccion[c.leccion_clave].append(Concepto(id=c.id, nombre=c.nombre))
    previas = defaultdict(list)
    for d in deps:
        previas[d.leccion_clave].append(d.depende_de)
    fila = await dp.plan_por_id(s, plan_id)
    return Plan(
        razonamiento=fila.razonamiento if fila else "",
        lecciones=[
            Leccion(
                clave=lec.clave,
                titulo=lec.titulo,
                objetivos=lec.objetivos,
                conceptos=por_leccion[lec.clave] or [Concepto(id="sin-concepto", nombre="Sin concepto")],
                horas=lec.horas,
                depende_de=previas[lec.clave],
            )
            for lec in lecs
        ],
    )


def _lunes(d: date) -> date:
    return d - timedelta(days=d.weekday())


async def vista_plan(s: AsyncSession, tema_id: int, hoy: date) -> dict | None:
    fila = await dp.plan_aceptado(s, tema_id)
    if fila is None:
        return None
    return await vista_por_id(s, fila.id, hoy)


async def vista_por_id(s: AsyncSession, plan_id: int, hoy: date) -> dict | None:
    fila = await dp.plan_por_id(s, plan_id)
    if fila is None:
        return None
    lecs = await dp.lecciones(s, plan_id)
    cons = await dp.conceptos(s, plan_id)
    deps = await dp.dependencias(s, plan_id)
    ses = await dp.sesiones(s, plan_id)
    apoyo = await rf.apoyo_de_plan(s, plan_id)
    biblioteca = await rf.biblioteca_de_plan(s, plan_id)
    apoyo_ids = await rf.apoyo_ids_de_plan(s, plan_id)
    tareas = await dp.ultimas_tareas_research(s, plan_id)
    apuntes = await dp.versiones_de_apuntes(s, plan_id)
    titulos = {lec.clave: lec.titulo for lec in lecs}
    hechas: dict[str, float] = defaultdict(float)
    programadas: dict[str, float] = defaultdict(float)
    for x in ses:
        programadas[x.leccion_clave] += x.horas
        if x.estado == "hecha":
            hechas[x.leccion_clave] += x.horas
    lecciones = []
    for lec in lecs:
        h = round(hechas[lec.clave], 2)
        estado = "hecha" if h >= lec.horas - 1e-6 else ("empezada" if h > 0 else "pendiente")
        lecciones.append(
            {
                "clave": lec.clave,
                "titulo": lec.titulo,
                "objetivos": lec.objetivos,
                "horas": lec.horas,
                "horas_hechas": h,
                "estado": estado,
                "depende_de": [d.depende_de for d in deps if d.leccion_clave == lec.clave],
                "conceptos": [{"id": c.id, "nombre": c.nombre} for c in cons if c.leccion_clave == lec.clave],
                "fuentes": apoyo.get(lec.clave, (0, True))[0],
                "sin_material": apoyo.get(lec.clave, (0, True))[1],
                "biblioteca": biblioteca_de_leccion(lec.objetivos, biblioteca.get(lec.clave, []), tareas.get(lec.clave)),
                # Con qué fuentes se hicieron los apuntes frente a las que hay ahora (None: aún no hay apuntes).
                "apuntes_fuentes": estado_apuntes(apuntes[lec.clave], apoyo_ids.get(lec.clave, []))
                if lec.clave in apuntes else None,
            }
        )
    semanas: dict[date, dict[date, list]] = defaultdict(lambda: defaultdict(list))
    for x in ses:
        semanas[_lunes(x.fecha)][x.fecha].append(
            {
                "id": x.id,
                "clave": x.leccion_clave,
                "titulo": titulos.get(x.leccion_clave, x.leccion_clave),
                "inicio": x.inicio.strftime("%H:%M") if x.inicio else None,
                "horas": x.horas,
                "estado": x.estado,
            }
        )
    total = round(sum(lec.horas for lec in lecs), 2)
    return {
        "plan_id": fila.id,
        "tema_id": fila.tema_id,
        "version": fila.version,
        "razonamiento": fila.razonamiento,
        "perfil": fila.perfil,
        "total_horas": total,
        "horas_hechas": round(sum(hechas.values()), 2),
        "progreso": round(sum(hechas.values()) / total, 3) if total else 0,
        "lecciones": lecciones,
        "semanas": [
            {
                "lunes": lunes.isoformat(),
                "dias": [{"fecha": d.isoformat(), "hoy": d == hoy, "sesiones": v} for d, v in sorted(dias.items())],
            }
            for lunes, dias in sorted(semanas.items())
        ],
        "fin": ses[-1].fecha.isoformat() if ses else None,
        "hoy": hoy.isoformat(),
        "examenes": await examenes_del_plan(s, fila.id, lecs, ses),
    }


async def recalcular(s: AsyncSession, tema_id: int, desde: date) -> dict | str | None:
    """Regenera las sesiones pendientes desde `desde`. Devuelve la vista, un mensaje si no cabe, o None."""
    fila = await dp.plan_aceptado(s, tema_id)
    if fila is None:
        return None
    perfil = Perfil.model_validate(fila.perfil)
    plan = await _plan_pydantic(s, fila.id)
    hechas: dict[str, float] = defaultdict(float)
    hoy_hechas = 0.0  # lo ya estudiado el día `desde`: lo siguiente va detrás, no a la misma hora
    for x in await dp.sesiones(s, fila.id):
        if x.estado in ("hecha", "saltada"):
            hechas[x.leccion_clave] += x.horas if x.estado == "hecha" else 0
        if x.estado == "hecha" and x.fecha == desde:
            hoy_hechas += x.horas
    inicios = [a_hora(h) for h in (perfil.inicio_por_dia or [None] * 7)]
    resultado = calendarizar(
        plan, perfil.horas_por_dia or [0] * 7, inicios, desde, None, dict(hechas), reglas_calendario(),
        usado_inicial=round(hoy_hechas * 60),
    )
    if isinstance(resultado, NoCabe):
        return resultado.mensaje()
    await dp.sustituir_pendientes(s, fila.id, [x.a_dict() for x in resultado.sesiones])
    return await vista_por_id(s, fila.id, desde)


async def resumen_planes(s: AsyncSession, hoy: date) -> list[dict]:
    salida = []
    for fila, nombre in await dp.planes_aceptados(s):
        v = await vista_por_id(s, fila.id, hoy)
        if v:
            salida.append(
                {
                    "plan_id": fila.id,
                    "tema_id": fila.tema_id,
                    "tema": nombre,
                    "version": fila.version,
                    "lecciones": len(v["lecciones"]),
                    "total_horas": v["total_horas"],
                    "horas_hechas": v["horas_hechas"],
                    "progreso": v["progreso"],
                    "fin": v["fin"],
                }
            )
    return salida


async def calendario(s: AsyncSession, desde: date, hasta: date) -> list[dict]:
    """Las sesiones de todos los planes aceptados entre dos fechas, por día."""
    dias: dict[date, list] = defaultdict(list)
    examenes: dict[date, list] = defaultdict(list)
    for fila, nombre in await dp.planes_aceptados(s):
        lecs = await dp.lecciones(s, fila.id)
        titulos = {lec.clave: lec.titulo for lec in lecs}
        todas = await dp.sesiones(s, fila.id)
        for h in await examenes_del_plan(s, fila.id, lecs, todas):
            f = date.fromisoformat(h["fecha"])
            if desde <= f <= hasta:
                examenes[f].append({**h, "tema": nombre, "tema_id": fila.tema_id, "plan_id": fila.id})
        for x in todas:
            if desde <= x.fecha <= hasta:
                dias[x.fecha].append(
                    {
                        "id": x.id,
                        "tema": nombre,
                        "tema_id": fila.tema_id,
                        "plan_id": fila.id,
                        "clave": x.leccion_clave,
                        "titulo": titulos.get(x.leccion_clave, ""),
                        "inicio": x.inicio.strftime("%H:%M") if x.inicio else None,
                        "horas": x.horas,
                        "estado": x.estado,
                    }
                )
    return [{"fecha": d.isoformat(), "sesiones": dias.get(d, []), "examenes": examenes.get(d, [])}
            for d in sorted(set(dias) | set(examenes))]


async def proponer_reajuste(s: AsyncSession, tema_id: int, ahora) -> dict | None:
    """El reajuste propuesto: reserva la carga de repasos y reparte lo pendiente. No aplica nada."""
    from magister.aprender.progreso import conceptos as estado_conceptos
    from magister.aprender.reajuste import diferencias, prever_carga, reajustar
    from magister.cerebro.modelo import Turno, generar

    fila = await dp.plan_aceptado(s, tema_id)
    if fila is None:
        return None
    perfil = Perfil.model_validate(fila.perfil)
    plan = await _plan_pydantic(s, fila.id)
    antes = [{"fecha": x.fecha.isoformat(), "clave": x.leccion_clave} for x in await dp.sesiones(s, fila.id) if x.estado == "pendiente"]
    hechas: dict[str, float] = defaultdict(float)
    for x in await dp.sesiones(s, fila.id):
        if x.estado == "hecha":
            hechas[x.leccion_clave] += x.horas
    estados = [c for c in await estado_conceptos(ahora) if c["plan_id"] == fila.id]
    por_leccion: dict[str, list[str]] = defaultdict(list)
    for c in estados:
        por_leccion[c["leccion_clave"]].append(c["estado"])
    dominadas = {k for k, v in por_leccion.items() if v and all(e == "dominado" for e in v)}
    carga = {x.fecha: x.minutos / 60 for x in await prever_carga(ahora, 28)}
    inicios = [a_hora(h) for h in (perfil.inicio_por_dia or [None] * 7)]
    # «Hoy» en tu zona, no en UTC: entre las 00:00 y la 01:00 (02:00 en verano) serían días distintos.
    hoy = ahora.astimezone(ZoneInfo(ajustes.zona)).date()
    nuevo, avisos = reajustar(plan, perfil.horas_por_dia or [0] * 7, inicios, hoy, perfil.plazo, dict(hechas), carga,
                              dominadas, reglas_calendario())
    if isinstance(nuevo, NoCabe):
        return {"cambios": [], "avisos": [nuevo.mensaje()], "sesiones": None, "texto": nuevo.mensaje()}
    despues = [x.a_dict() for x in nuevo.sesiones]
    cambios = diferencias(antes, [{"fecha": x["fecha"], "clave": x["clave"]} for x in despues])
    texto = ""
    if cambios:
        sistema = ("Eres el tutor. Explica al alumno en tres o cuatro frases, en español de España y tuteando, este cambio de su "
                   "calendario. No decides nada: el cambio ya está calculado. Sin el carácter de la raya larga.")
        texto = "".join([t async for t in generar(sistema, [Turno("usuario", "\n".join(cambios + avisos))])]).strip()
    return {"cambios": cambios, "avisos": avisos, "sesiones": despues, "texto": texto, "plan_id": fila.id}


async def aplicar_reajuste(s: AsyncSession, tema_id: int, sesiones: list[dict], hoy) -> dict | None:
    fila = await dp.plan_aceptado(s, tema_id)
    if fila is None:
        return None
    await dp.sustituir_pendientes(s, fila.id, sesiones)
    return await vista_por_id(s, fila.id, hoy)
