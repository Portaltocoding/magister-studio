"""Proyectos: algo que construyes, con su roadmap de construcción, lo que llevas hecho y su diario de decisiones."""

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, select, update

from magister.datos.material import Trabajo
from magister.datos.proyectos import Decision, Proyecto
from magister.datos.sesion import nueva_sesion
from magister.proyectos.estado import EN_COLA, GENERANDO, trabajo_de
from magister.proyectos.roadmap import apuntar_perdidos, pasos, por_detallar
from magister.trabajos import cola

# --- Los 422, en castellano ---------------------------------------------------------------------------------------

_NOMBRES = {
    "nombre": "el nombre", "idea": "la idea", "objetivo": "para qué lo quieres", "sabes": "lo que ya sabes",
    "ritmo": "tu ritmo", "investigar": "buscar en la web", "titulo": "el título", "contexto": "el contexto",
    "decision": "la decisión", "consecuencias": "lo que implica", "paso_id": "el paso", "hecho": "hecho",
    "confirmado": "confirmado", "pid": "el número del proyecto", "numero": "el número del nivel",
    "did": "el número de la decisión", "cambio_id": "el número del cambio", "cid": "el número de la conversación",
}


def texto_validacion(errores: list[dict]) -> str:
    """Los errores de validación de Pydantic (en inglés) como una frase en castellano para el alumno."""
    frases = []
    for e in errores:
        loc = [str(x) for x in e.get("loc", ()) if x not in ("body", "path", "query")]
        campo = _NOMBRES.get(loc[-1], f"«{loc[-1]}»") if loc else "el cuerpo de la petición"
        tipo, ctx = e.get("type", ""), e.get("ctx") or {}
        if tipo == "missing":
            frase = f"falta {campo}"
        elif tipo == "string_too_short":
            minimo = ctx.get("min_length")
            frase = f"{campo} necesita al menos {minimo} {'carácter' if minimo == 1 else 'caracteres'}, sin contar los espacios"
        elif tipo == "string_too_long":
            frase = f"{campo} admite como mucho {ctx.get('max_length')} caracteres"
        elif tipo in ("int_parsing", "int_type", "int_from_float"):
            frase = f"{campo} tiene que ser un número entero"
        elif tipo in ("bool_parsing", "bool_type"):
            frase = f"{campo} tiene que ser true o false"
        elif tipo == "string_type":
            frase = f"{campo} tiene que ser un texto"
        elif tipo == "json_invalid":
            frase = "lo que se ha enviado no es un JSON válido"
        elif tipo in ("model_attributes_type", "dict_type", "model_type"):
            frase = "lo que se envía tiene que ser un objeto JSON"
        elif tipo == "value_error":
            frase = str(ctx.get("error") or e.get("msg", "")).removeprefix("Value error, ")
        elif tipo in ("greater_than_equal", "greater_than", "less_than_equal", "less_than"):
            frase = f"{campo} se sale de lo permitido"
        else:
            frase = f"{campo} no es válido"
        frases.append(frase)
    return "; ".join(dict.fromkeys(frases)) or "la petición no es válida"


class RutaEnCastellano(APIRoute):
    """Una ruta cuyos 422 dicen en castellano qué está mal (`detail` es una frase, no la lista de Pydantic)."""

    def get_route_handler(self):
        original = super().get_route_handler()

        async def manejar(peticion):
            try:
                return await original(peticion)
            except RequestValidationError as e:
                return JSONResponse({"detail": texto_validacion(list(e.errors()))}, status_code=422)

        return manejar


rutas = APIRouter(prefix="/api", route_class=RutaEnCastellano)


def _limpio(v: object) -> object:
    """Sin espacios alrededor: un nombre de solo espacios es un nombre vacío (y lo vacío opcional, None)."""
    return v.strip() if isinstance(v, str) else v


def _opcional(v: object) -> object:
    v = _limpio(v)
    return (v or None) if isinstance(v, str) else v


class ProyectoEntrada(BaseModel):
    nombre: str = Field(min_length=2, max_length=200)
    idea: str = Field(min_length=10, max_length=8000)
    objetivo: str | None = Field(None, max_length=2000)
    sabes: str | None = Field(None, max_length=4000)
    ritmo: str | None = Field(None, max_length=200)
    investigar: bool = True  # buscar en la web proyectos y documentación parecidos antes de hacer el roadmap

    _obligatorios = field_validator("nombre", "idea", mode="before")(_limpio)
    _opcionales = field_validator("objetivo", "sabes", "ritmo", mode="before")(_opcional)


def _progreso(p: Proyecto) -> dict:
    todos = pasos(p.roadmap or {})
    hechos = set(p.hechos or [])
    niveles = (p.roadmap or {}).get("niveles", [])
    # El nivel en el que estás: el primero con pasos sin hacer (o por detallar, aunque sea un bloque).
    actual = next((n["numero"] for n in niveles
                   if por_detallar(n) or any(x["id"] not in hechos for b in n["bloques"] for x in b["pasos"])),
                  len(niveles) or None)
    return {"pasos": len(todos), "hechos": sum(1 for x in todos if x["id"] in hechos), "nivel": actual, "niveles": len(niveles)}


async def _reconciliar(proyectos: list[Proyecto]) -> dict[int, str]:
    """Ningún proyecto se queda «generando» para siempre: si su trabajo ya no está en marcha (falló, se canceló, se
    perdió o acabó sin que el proyecto se enterase), pasa a «listo» si tiene roadmap o a «error» si no.
    Una consulta para todos los proyectos que se están generando. Devuelve el estado del trabajo (pendiente o
    en_curso) de los que siguen con uno en marcha: con él en cola, el proyecto se ve «en cola»."""
    generando = [p for p in proyectos if p.estado == GENERANDO]
    if not generando:
        return {}
    ids = {p.trabajo_id for p in generando if p.trabajo_id is not None}
    trabajos: dict[int, tuple[str, str | None]] = {}
    if ids:
        async with nueva_sesion() as s:
            trabajos = {i: (e, err) for i, e, err in (await s.execute(
                select(Trabajo.id, Trabajo.estado, Trabajo.error).where(Trabajo.id.in_(ids)))).all()}
    en_marcha: dict[int, str] = {}
    for p in generando:
        t = trabajos.get(p.trabajo_id) if p.trabajo_id is not None else None
        if t is not None and t[0] in ("pendiente", "en_curso"):
            en_marcha[p.id] = t[0]
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
                Proyecto.id == p.id, Proyecto.estado == GENERANDO, Proyecto.trabajo_id.is_not_distinct_from(p.trabajo_id))
                .values(estado=estado, error=motivo, trabajo_id=None))
        if r.rowcount:
            p.estado, p.error, p.trabajo_id = estado, motivo, None
    return en_marcha


async def _estado_trabajo(p: Proyecto) -> dict | None:
    """Si se está generando o espera en la cola: en qué va, dónde está en la cola y si hay un trabajador en marcha."""
    await _reconciliar([p])
    if p.trabajo_id is None:
        return None
    t = await cola.leer(p.trabajo_id)
    if t is None:
        return None
    async with nueva_sesion() as s:
        del_proyecto = await trabajo_de(s, p)
    return {**{k: t.get(k) for k in ("estado", "nodo", "paso", "total", "error", "tipo", "cola")}, "id": p.trabajo_id,
            # El nivel que va a detallar (None si rehace el roadmap): la pantalla dice qué está haciendo.
            "nivel": del_proyecto.nivel if del_proyecto else None,
            "trabajador_vivo": await cola.trabajador_vivo()}


def _estado(p: Proyecto, trabajo: str | None) -> str:
    """«en_cola» si su trabajo aún no ha empezado; si no, el de la base (generando, listo, error)."""
    return EN_COLA if p.estado == GENERANDO and trabajo == "pendiente" else p.estado


def _salida(p: Proyecto, completo: bool = True, trabajo: str | None = None) -> dict:
    base = {"id": p.id, "nombre": p.nombre, "estado": _estado(p, trabajo), "error": p.error,
            "creado_en": p.creado_en.isoformat(), "progreso": _progreso(p)}
    if not completo:
        return base
    return {**base, "idea": p.idea, "objetivo": p.objetivo, "sabes": p.sabes, "ritmo": p.ritmo, "roadmap": p.roadmap,
            "referencias": p.referencias or [], "arquitectura_svg": p.arquitectura_svg, "hechos": p.hechos or [],
            "hechos_en": p.hechos_en or {},
            # Hay un roadmap de antes del último «rehacer» al que se puede volver.
            "anterior": bool((p.roadmap_anterior or {}).get("roadmap"))}


async def _proyecto(pid: int) -> Proyecto:
    async with nueva_sesion() as s:
        p = await s.get(Proyecto, pid)
    if p is None:
        raise HTTPException(404, "proyecto no encontrado")
    return p


async def _ver(pid: int, completo: bool = True) -> dict:
    p = await _proyecto(pid)
    en_marcha = await _reconciliar([p])
    return _salida(p, completo, en_marcha.get(p.id))


GENERANDO_YA = "ya se está generando algo de este proyecto"
EN_COLA_YA = ("este proyecto ya tiene un trabajo en la cola: espera a que acabe o cancélalo (botón «Cancelar») para "
              "pedir otro")


async def _encolar(pid: int, tipo: str, parametros: dict, comprobar=None) -> dict:
    """Encola un trabajo del proyecto, con la fila bloqueada: comprobar que está libre y encolar es una sola cosa, así
    que dos peticiones a la vez (un doble clic) no encolan dos. Si ya tiene en marcha justo ese mismo encargo, lo
    devuelve tal cual (el segundo clic no hace nada); si tiene otro, 409. `comprobar(p)` valida lo demás (lanza
    HTTPException). La clave de idempotencia sale de la fila (cuándo se escribió por última vez), no del reloj: el
    mismo encargo sobre el mismo proyecto es el mismo trabajo, y cualquier cambio en él da uno nuevo."""
    async with nueva_sesion() as s, s.begin():
        p = await s.scalar(select(Proyecto).where(Proyecto.id == pid).with_for_update())
        if p is None:
            raise HTTPException(404, "proyecto no encontrado")
        t = await trabajo_de(s, p)
        if t is not None:
            if t.mismo(tipo, parametros):
                return _salida(p, trabajo=t.estado)
            raise HTTPException(409, EN_COLA_YA if t.ocupacion == EN_COLA else GENERANDO_YA)
        if comprobar is not None:
            comprobar(p)
        version = p.actualizado_en.isoformat() if p.actualizado_en else ""
        tid, _ = await cola.encolar(tipo, None, None, {"proyecto_id": pid, **parametros},
                                    cola.clave_idempotencia(tipo=tipo, proyecto=pid, version=version, **parametros))
        p.estado, p.trabajo_id, p.error = GENERANDO, tid, None
        await s.flush()
        estado = await s.scalar(select(Trabajo.estado).where(Trabajo.id == tid))
        return _salida(p, trabajo=estado)


@rutas.get("/proyectos")
async def listar() -> list[dict]:
    async with nueva_sesion() as s:
        filas = list((await s.scalars(select(Proyecto).order_by(Proyecto.actualizado_en.desc()))).all())
    # Si no, un proyecto cuyo trabajo falló seguiría saliendo «Preparando el roadmap…» en la lista hasta abrirlo.
    en_marcha = await _reconciliar(filas)
    return [_salida(p, completo=False, trabajo=en_marcha.get(p.id)) for p in filas]


@rutas.post("/proyectos", status_code=201)
async def crear(cuerpo: ProyectoEntrada) -> dict:
    datos = cuerpo.model_dump(exclude={"investigar"})
    async with nueva_sesion() as s, s.begin():
        p = Proyecto(**datos)
        s.add(p)
        await s.flush()
        pid = p.id
    return await _encolar(pid, "proyecto_roadmap", {"investigar": cuerpo.investigar})


@rutas.get("/proyectos/{pid}")
async def ver(pid: int) -> dict:
    p = await _proyecto(pid)
    trabajo = await _estado_trabajo(p)
    return {**_salida(p, trabajo=(trabajo or {}).get("estado")), "trabajo": trabajo}


@rutas.delete("/proyectos/{pid}", status_code=204)
async def borrar(pid: int) -> None:
    """Borra el proyecto y, antes, cancela sus trabajos de la cola que aún no han acabado (si no, el modelo se gasta
    en un proyecto que ya no existe)."""
    async with nueva_sesion() as s:
        if await s.get(Proyecto, pid) is None:
            raise HTTPException(404, "proyecto no encontrado")
        vivos = (await s.scalars(select(Trabajo.id).where(
            Trabajo.parametros["proyecto_id"].astext == str(pid), Trabajo.tipo.in_(("proyecto_roadmap", "proyecto_nivel")),
            Trabajo.estado.in_(("pendiente", "en_curso"))))).all()
    for tid in vivos:
        await cola.cancelar(tid)
    async with nueva_sesion() as s, s.begin():
        await s.execute(delete(Proyecto).where(Proyecto.id == pid))


class Rehacer(BaseModel):
    confirmado: bool = False  # ya sabes lo que pasa con lo hecho (hace falta si tienes pasos hechos)


def aviso_rehacer(hechos: int) -> str:
    return (f"Tienes {hechos} {'paso hecho' if hechos == 1 else 'pasos hechos'}. Rehacer el roadmap gasta cuota; se "
            "intentarán conservar los que sigan existiendo, lo hecho de los que no se apunta aparte y el roadmap de "
            "ahora se guarda para poder volver a él. Confírmalo para seguir.")


@rutas.post("/proyectos/{pid}/rehacer")
async def rehacer(pid: int, cuerpo: Rehacer | None = None) -> dict:
    """Vuelve a generar el roadmap entero (si falló, o si cambiaste la idea). Si ya había uno, al terminar se empareja
    por contenido con el nuevo (`roadmap.conservar`): los pasos que siguen heredan su id, así que lo hecho, sus fechas y
    el diario siguen valiendo; lo hecho de los que ya no están se apunta en «ya_no_estan» del roadmap, y el roadmap de
    antes se guarda en `roadmap_anterior` para volver a él (`/volver`). Con pasos hechos, sin `confirmado` responde
    428 con lo que va a pasar y no encola nada."""
    def comprobar(p: Proyecto) -> None:
        hechos = _progreso(p)["hechos"]
        if hechos and not (cuerpo and cuerpo.confirmado):
            raise HTTPException(428, aviso_rehacer(hechos))

    return await _encolar(pid, "proyecto_roadmap", {"investigar": True}, comprobar)


@rutas.post("/proyectos/{pid}/volver")
async def volver(pid: int) -> dict:
    """Vuelve al roadmap de antes del último «rehacer», y el de ahora pasa a ser el anterior (se puede ir y volver).
    Lo hecho no se toca: los pasos que están en los dos tienen el mismo id; lo hecho de los que no, se apunta aparte."""
    async with nueva_sesion() as s, s.begin():
        p = await s.scalar(select(Proyecto).where(Proyecto.id == pid).with_for_update())
        if p is None:
            raise HTTPException(404, "proyecto no encontrado")
        if (t := await trabajo_de(s, p)) is not None:
            # El trabajo en cola se haría sobre el otro roadmap: primero se cancela.
            raise HTTPException(409, EN_COLA_YA if t.ocupacion == EN_COLA else GENERANDO_YA)
        anterior = p.roadmap_anterior
        if not anterior or not anterior.get("roadmap"):
            raise HTTPException(409, "no hay un roadmap anterior al que volver")
        actual = p.roadmap or {}
        p.roadmap_anterior = {"roadmap": actual, "arquitectura_svg": p.arquitectura_svg, "trabajo_id": None}
        # «conservados» cuenta lo del último rehacer: en el roadmap al que se vuelve ya no dice nada.
        de_antes = {k: v for k, v in anterior["roadmap"].items() if k not in ("conservados", "no_conservados")}
        p.roadmap = apuntar_perdidos(actual, de_antes, list(p.hechos or []), dict(p.hechos_en or {}))
        p.arquitectura_svg = anterior.get("arquitectura_svg")
    return await _ver(pid)


class Hecho(BaseModel):
    hecho: bool


@rutas.put("/proyectos/{pid}/pasos/{paso_id}")
async def marcar(pid: int, paso_id: str, cuerpo: Hecho) -> dict:
    """Marca o desmarca un paso. Con la fila bloqueada, como el arnés del asesor: varias marcas a la vez (clics
    seguidos en varias casillas) se hacen una detrás de otra y no se pisan."""
    async with nueva_sesion() as s, s.begin():
        p = await s.scalar(select(Proyecto).where(Proyecto.id == pid).with_for_update())
        if p is None:
            raise HTTPException(404, "proyecto no encontrado")
        if paso_id not in {x["id"] for x in pasos(p.roadmap or {})}:
            raise HTTPException(404, "ese paso no existe")
        hechos = [x for x in (p.hechos or []) if x != paso_id]
        p.hechos = [*hechos, paso_id] if cuerpo.hecho else hechos
        fechas = {k: v for k, v in (p.hechos_en or {}).items() if k != paso_id}
        if cuerpo.hecho:
            fechas[paso_id] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        p.hechos_en = fechas
    return await _ver(pid, completo=False)


@rutas.post("/proyectos/{pid}/niveles/{numero}/detallar")
async def detallar(pid: int, numero: int) -> dict:
    def comprobar(p: Proyecto) -> None:
        nivel = next((n for n in (p.roadmap or {}).get("niveles", []) if n["numero"] == numero), None)
        if nivel is None:
            raise HTTPException(404, "ese nivel no existe")
        # Volver a detallarlo machacaría sus pasos con otros y lo marcado como hecho dejaría de cuadrar. Si le quedan
        # bloques sin pasos (un roadmap rehecho que trajo uno nuevo), se rellenan solo esos.
        if not por_detallar(nivel):
            raise HTTPException(409, "ese nivel ya tiene sus pasos")

    return await _encolar(pid, "proyecto_nivel", {"numero": numero}, comprobar)


class DecisionEntrada(BaseModel):
    titulo: str = Field(min_length=3, max_length=300)
    contexto: str | None = Field(None, max_length=4000)
    decision: str = Field(min_length=3, max_length=4000)
    consecuencias: str | None = Field(None, max_length=4000)
    paso_id: str | None = Field(None, max_length=40)

    _obligatorios = field_validator("titulo", "decision", mode="before")(_limpio)
    _opcionales = field_validator("contexto", "consecuencias", "paso_id", mode="before")(_opcional)


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
    p = await _proyecto(pid)
    # El paso tiene que ser uno del roadmap (o uno hecho que ya no está, que el diario puede seguir nombrando).
    validos = {x["id"] for x in pasos(p.roadmap or {})} | {x["id"] for x in (p.roadmap or {}).get("ya_no_estan", [])}
    if cuerpo.paso_id is not None and cuerpo.paso_id not in validos:
        raise HTTPException(422, "ese paso no está en el proyecto: elige uno de la lista o «Sin paso concreto»")
    async with nueva_sesion() as s, s.begin():
        d = Decision(proyecto_id=pid, **cuerpo.model_dump())
        s.add(d)
        await s.flush()
        await s.refresh(d)
        return _decision(d)


@rutas.delete("/proyectos/{pid}/decisiones/{did}", status_code=204)
async def borrar_decision(pid: int, did: int) -> None:
    async with nueva_sesion() as s, s.begin():
        await s.execute(delete(Decision).where(Decision.id == did, Decision.proyecto_id == pid))
