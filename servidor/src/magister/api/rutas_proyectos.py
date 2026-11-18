"""Proyectos: algo que construyes, con su roadmap de construcción, lo que llevas hecho y su diario de decisiones."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, select, update

from magister.datos.material import Trabajo
from magister.datos.proyectos import Decision, Proyecto
from magister.datos.sesion import nueva_sesion
from magister.proyectos.roadmap import pasos
from magister.trabajos import cola

rutas = APIRouter(prefix="/api")


class ProyectoEntrada(BaseModel):
    nombre: str = Field(min_length=2, max_length=200)
    idea: str = Field(min_length=10, max_length=8000)
    objetivo: str | None = Field(None, max_length=2000)
    sabes: str | None = Field(None, max_length=4000)
    ritmo: str | None = Field(None, max_length=200)
    investigar: bool = True  # buscar en la web proyectos y documentación parecidos antes de hacer el roadmap


def _progreso(p: Proyecto) -> dict:
    todos = pasos(p.roadmap or {})
    hechos = set(p.hechos or [])
    niveles = (p.roadmap or {}).get("niveles", [])
    # El nivel en el que estás: el primero con pasos sin hacer (o sin detallar).
    actual = next((n["numero"] for n in niveles
                   if not n.get("detallado") or any(x["id"] not in hechos for b in n["bloques"] for x in b["pasos"])),
                  len(niveles) or None)
    return {"pasos": len(todos), "hechos": sum(1 for x in todos if x["id"] in hechos), "nivel": actual, "niveles": len(niveles)}


async def _reconciliar(proyectos: list[Proyecto]) -> None:
    """Ningún proyecto se queda «generando» para siempre: si su trabajo ya no está en marcha (falló, se canceló, se
    perdió o acabó sin que el proyecto se enterase), pasa a «listo» si tiene roadmap o a «error» si no.
    Una consulta para todos los proyectos que se están generando."""
    generando = [p for p in proyectos if p.estado == "generando"]
    if not generando:
        return
    ids = {p.trabajo_id for p in generando if p.trabajo_id is not None}
    trabajos: dict[int, tuple[str, str | None]] = {}
    if ids:
        async with nueva_sesion() as s:
            trabajos = {i: (e, err) for i, e, err in (await s.execute(
                select(Trabajo.id, Trabajo.estado, Trabajo.error).where(Trabajo.id.in_(ids)))).all()}
    for p in generando:
        t = trabajos.get(p.trabajo_id) if p.trabajo_id is not None else None
        if t is not None and t[0] in ("pendiente", "en_curso"):
            continue
        if t is None:
            motivo = "se perdió el trabajo que lo preparaba"
        elif t[0] == "hecho":
            motivo = "terminó sin roadmap"
        else:
            motivo = t[1] or ("cancelado" if t[0] == "cancelado" else "no se pudo generar")
        estado = "listo" if p.roadmap else "error"
        async with nueva_sesion() as s, s.begin():
            # Solo si nadie lo ha cambiado mientras tanto (el trabajador pudo terminarlo justo ahora).
            r = await s.execute(update(Proyecto).where(
                Proyecto.id == p.id, Proyecto.estado == "generando", Proyecto.trabajo_id.is_not_distinct_from(p.trabajo_id))
                .values(estado=estado, error=motivo, trabajo_id=None))
        if r.rowcount:
            p.estado, p.error, p.trabajo_id = estado, motivo, None


async def _estado_trabajo(p: Proyecto) -> dict | None:
    """Si se está generando: en qué va, y si hay un trabajador en marcha que lo vaya a hacer."""
    await _reconciliar([p])
    if p.trabajo_id is None:
        return None
    t = await cola.leer(p.trabajo_id)
    if t is None:
        return None
    return {**{k: t.get(k) for k in ("estado", "nodo", "paso", "total", "error")}, "id": p.trabajo_id,
            "trabajador_vivo": await cola.trabajador_vivo()}


def _salida(p: Proyecto, completo: bool = True) -> dict:
    base = {"id": p.id, "nombre": p.nombre, "estado": p.estado, "error": p.error, "creado_en": p.creado_en.isoformat(),
            "progreso": _progreso(p)}
    if not completo:
        return base
    return {**base, "idea": p.idea, "objetivo": p.objetivo, "sabes": p.sabes, "ritmo": p.ritmo, "roadmap": p.roadmap,
            "referencias": p.referencias or [], "arquitectura_svg": p.arquitectura_svg, "hechos": p.hechos or [],
            "hechos_en": p.hechos_en or {}}


async def _proyecto(pid: int) -> Proyecto:
    async with nueva_sesion() as s:
        p = await s.get(Proyecto, pid)
    if p is None:
        raise HTTPException(404, "proyecto no encontrado")
    return p


async def _encolar(pid: int, tipo: str, parametros: dict) -> int:
    tid, _ = await cola.encolar(tipo, None, None, {"proyecto_id": pid, **parametros},
                                cola.clave_idempotencia(tipo=tipo, proyecto=pid, **parametros))
    async with nueva_sesion() as s, s.begin():
        fila = await s.get(Proyecto, pid)
        fila.estado, fila.trabajo_id, fila.error = "generando", tid, None
    return tid


@rutas.get("/proyectos")
async def listar() -> list[dict]:
    async with nueva_sesion() as s:
        filas = list((await s.scalars(select(Proyecto).order_by(Proyecto.actualizado_en.desc()))).all())
    # Si no, un proyecto cuyo trabajo falló seguiría saliendo «Preparando el roadmap…» en la lista hasta abrirlo.
    await _reconciliar(filas)
    return [_salida(p, completo=False) for p in filas]


@rutas.post("/proyectos", status_code=201)
async def crear(cuerpo: ProyectoEntrada) -> dict:
    datos = cuerpo.model_dump(exclude={"investigar"})
    async with nueva_sesion() as s, s.begin():
        p = Proyecto(**{k: (v.strip() if isinstance(v, str) else v) or None for k, v in datos.items()})
        s.add(p)
        await s.flush()
        pid = p.id
    await _encolar(pid, "proyecto_roadmap", {"investigar": cuerpo.investigar})
    return _salida(await _proyecto(pid))


@rutas.get("/proyectos/{pid}")
async def ver(pid: int) -> dict:
    p = await _proyecto(pid)
    trabajo = await _estado_trabajo(p)
    return {**_salida(p), "trabajo": trabajo}


@rutas.delete("/proyectos/{pid}", status_code=204)
async def borrar(pid: int) -> None:
    async with nueva_sesion() as s, s.begin():
        await s.execute(delete(Proyecto).where(Proyecto.id == pid))


@rutas.post("/proyectos/{pid}/rehacer")
async def rehacer(pid: int) -> dict:
    """Vuelve a generar el roadmap (si falló, o si cambiaste la idea). Lo hecho se conserva por id de paso."""
    await _proyecto(pid)
    await _encolar(pid, "proyecto_roadmap", {"investigar": True, "vez": await _siguiente_vez(pid)})
    return _salida(await _proyecto(pid))


async def _siguiente_vez(pid: int) -> int:
    """Para que «rehacer» encole un trabajo nuevo (la clave de idempotencia cambia cada vez)."""
    import time

    return int(time.time())


class Hecho(BaseModel):
    hecho: bool


@rutas.put("/proyectos/{pid}/pasos/{paso_id}")
async def marcar(pid: int, paso_id: str, cuerpo: Hecho) -> dict:
    async with nueva_sesion() as s, s.begin():
        p = await s.get(Proyecto, pid)
        if p is None:
            raise HTTPException(404, "proyecto no encontrado")
        if paso_id not in {x["id"] for x in pasos(p.roadmap or {})}:
            raise HTTPException(404, "ese paso no existe")
        hechos = [x for x in (p.hechos or []) if x != paso_id]
        p.hechos = [*hechos, paso_id] if cuerpo.hecho else hechos
        fechas = {k: v for k, v in (p.hechos_en or {}).items() if k != paso_id}
        if cuerpo.hecho:
            from datetime import datetime, timezone

            fechas[paso_id] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        p.hechos_en = fechas
    return _salida(await _proyecto(pid), completo=False)


@rutas.post("/proyectos/{pid}/niveles/{numero}/detallar")
async def detallar(pid: int, numero: int) -> dict:
    p = await _proyecto(pid)
    if not any(n["numero"] == numero for n in (p.roadmap or {}).get("niveles", [])):
        raise HTTPException(404, "ese nivel no existe")
    if p.estado == "generando":
        raise HTTPException(409, "ya se está generando algo de este proyecto")
    await _encolar(pid, "proyecto_nivel", {"numero": numero, "vez": await _siguiente_vez(pid)})
    return _salida(await _proyecto(pid))


class DecisionEntrada(BaseModel):
    titulo: str = Field(min_length=3, max_length=300)
    contexto: str | None = Field(None, max_length=4000)
    decision: str = Field(min_length=3, max_length=4000)
    consecuencias: str | None = Field(None, max_length=4000)
    paso_id: str | None = Field(None, max_length=40)


def _decision(d: Decision) -> dict:
    return {"id": d.id, "titulo": d.titulo, "contexto": d.contexto, "decision": d.decision,
            "consecuencias": d.consecuencias, "paso_id": d.paso_id, "creada_en": d.creada_en.isoformat()}


@rutas.get("/proyectos/{pid}/decisiones")
async def decisiones(pid: int) -> list[dict]:
    await _proyecto(pid)
    async with nueva_sesion() as s:
        filas = (await s.scalars(select(Decision).where(Decision.proyecto_id == pid).order_by(Decision.id.desc()))).all()
    return [_decision(d) for d in filas]


@rutas.post("/proyectos/{pid}/decisiones", status_code=201)
async def apuntar(pid: int, cuerpo: DecisionEntrada) -> dict:
    await _proyecto(pid)
    async with nueva_sesion() as s, s.begin():
        d = Decision(proyecto_id=pid, **{k: (v.strip() if isinstance(v, str) else v) or None for k, v in cuerpo.model_dump().items()})
        s.add(d)
        await s.flush()
        await s.refresh(d)
        return _decision(d)


@rutas.delete("/proyectos/{pid}/decisiones/{did}", status_code=204)
async def borrar_decision(pid: int, did: int) -> None:
    async with nueva_sesion() as s, s.begin():
        await s.execute(delete(Decision).where(Decision.id == did, Decision.proyecto_id == pid))
