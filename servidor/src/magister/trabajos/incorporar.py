"""El trabajo «incorporar»: meter en tus fuentes, de una vez, las propuestas del research que siguen pendientes.

Por cada propuesta: descargar (con el tope de tamaño y comprobando la dirección en cada salto), recibir, extraer y
validar, y marcarla aprobada con su version_id. Si una falla (404, no es una página, vacía, dirección prohibida) se
anota por qué y se sigue con las demás. Trocear y embeber lo hace luego el bucle de fondo de la ingesta, que también
recalcula el apoyo de las lecciones. No llama al modelo: no gasta cuota.

Idempotente: solo toca propuestas pendientes, una URL con una versión viva no se vuelve a bajar y cada propuesta se
anota una sola vez (reanudar no duplica). Lo anotado va en `avisos` del trabajo, una entrada por propuesta:
{"regla": "incorporada" | "no_incorporada", "propuesta_id", "url", "titulo", "leccion_clave", "motivo", "version_id"},
más "incompleta" (el motivo) si entró solo un pedazo: se queda, pero marcado (`versiones.metadatos.incompleta`).
"""

import httpx
from sqlalchemy import select, update

from magister.datos import plan as dp
from magister.datos import repositorio_fuentes as rf
from magister.datos.fuentes import Propuesta, Version
from magister.datos.material import Trabajo
from magister.datos.sesion import nueva_sesion
from magister.fuentes import ingesta
from magister.material.generador import Cancelado
from magister.trabajos import cola

TIPO = "incorporar"
FUENTE = "Propuestas del research"  # todas las que vienen del research van aquí: borrarla quita todas
ENTRA, NO_ENTRA = "incorporada", "no_incorporada"


def motivo_de(e: Exception) -> str:
    """Por qué no entró una propuesta, en una frase."""
    from magister.seguridad.politica import UrlProhibida

    if isinstance(e, UrlProhibida):
        return f"dirección prohibida: {e}"
    if isinstance(e, httpx.HTTPStatusError):
        return f"la página da error {e.response.status_code}"
    if isinstance(e, httpx.TimeoutException):
        return "la página no responde"
    if isinstance(e, httpx.TransportError):
        return f"no se pudo conectar con la página ({type(e).__name__})"
    if isinstance(e, ValueError):
        return str(e)
    return f"{type(e).__name__}: {e}"


async def pendientes(plan_id: int | None = None, leccion_clave: str | None = None, tarea_id: int | None = None) -> list[int]:
    consulta = select(Propuesta.id).where(Propuesta.estado == "pendiente").order_by(Propuesta.id)
    if plan_id is not None:
        consulta = consulta.where(Propuesta.plan_id == plan_id)
    if leccion_clave is not None:
        consulta = consulta.where(Propuesta.leccion_clave == leccion_clave)
    if tarea_id is not None:
        consulta = consulta.where(Propuesta.tarea_id == tarea_id)
    async with nueva_sesion() as s:
        return list((await s.scalars(consulta)).all())


async def encolar(plan_id: int | None = None, leccion_clave: str | None = None, tarea_id: int | None = None,
                  automatica: bool = False, ronda: str = "") -> tuple[int | None, int]:
    """(trabajo_id, cuántas). Las propuestas se fijan al encolar: la clave depende de cuáles son y de `ronda`."""
    ids = await pendientes(plan_id, leccion_clave, tarea_id)
    if not ids:
        return None, 0
    clave = cola.clave_idempotencia(tipo=TIPO, ids=ids, ronda=ronda)
    tid, _ = await cola.encolar(TIPO, plan_id, leccion_clave, {"ids": ids, "automatica": automatica}, clave)
    return tid, len(ids)


def resumen(t: dict) -> dict:
    """Lo que la Biblioteca enseña de un trabajo de incorporar: cuántas van, cuántas han entrado y las que no, con su porqué."""
    parametros = t.get("parametros") or {}
    anotadas = [a for a in t.get("avisos") or [] if a.get("regla") in (ENTRA, NO_ENTRA)]
    fallidas = [{k: a.get(k) for k in ("propuesta_id", "url", "titulo", "leccion_clave", "motivo")}
                for a in anotadas if a["regla"] == NO_ENTRA]
    incompletas = [{k: a.get(k) for k in ("propuesta_id", "url", "titulo", "leccion_clave", "version_id", "incompleta")}
                   for a in anotadas if a["regla"] == ENTRA and a.get("incompleta")]
    return {"trabajo_id": t["id"], "estado": t["estado"], "error": t.get("error"),
            "total": len(parametros.get("ids", [])), "van": len(anotadas), "entradas": len(anotadas) - len(fallidas),
            "fallidas": fallidas, "incompletas": incompletas, "automatica": bool(parametros.get("automatica")),
            "acabado_en": t.get("acabado_en")}


def _como_dict(t: Trabajo) -> dict:
    return {"id": t.id, "estado": t.estado, "error": t.error, "parametros": t.parametros, "avisos": t.avisos,
            "acabado_en": t.acabado_en.isoformat() if t.acabado_en else None}


async def en_marcha() -> int | None:
    """Un «Incorporar todas» que aún no ha acabado (los automáticos del research no cuentan)."""
    async with nueva_sesion() as s:
        filas = (await s.scalars(select(Trabajo).where(Trabajo.tipo == TIPO, Trabajo.estado.in_(("pendiente", "en_curso")))
                                 .order_by(Trabajo.id.desc()))).all()
    return next((t.id for t in filas if not (t.parametros or {}).get("automatica")), None)


async def leer(trabajo_id: int | None = None) -> dict | None:
    """El resumen de un trabajo de incorporar o, sin id, del último."""
    async with nueva_sesion() as s:
        if trabajo_id is None:
            t = await s.scalar(select(Trabajo).where(Trabajo.tipo == TIPO).order_by(Trabajo.id.desc()).limit(1))
        else:
            t = await s.get(Trabajo, trabajo_id)
    if t is None or t.tipo != TIPO:
        return None
    return resumen(_como_dict(t))


async def _anotar(trabajo_id: int, entrada: dict) -> None:
    async with nueva_sesion() as s, s.begin():
        t = await s.get(Trabajo, trabajo_id, with_for_update=True)
        otras = [a for a in t.avisos if a.get("propuesta_id") != entrada["propuesta_id"]]
        t.avisos = [*otras, {**entrada, "detalle": entrada.get("motivo") or ""}]
        await cola.avisar(trabajo_id, s)


async def _version_que_vale(s, vid: int) -> Version:
    """Si la bajada repetía un contenido que el documento ya tenía («retirada · sin cambios»), vale aquella."""
    v = await s.get(Version, vid)
    if v.estado == "retirada" and v.motivo == "sin cambios":
        otras = [x for x in await rf.versiones_de_documento(s, v.documento_id) if x.id != vid and x.estado != "retirada"]
        if otras:
            return otras[-1]
    return v


async def _una(pid: int, fuente_id: int, automatica: bool, temas: dict[int, int | None]) -> dict | None:
    """Todo dentro del try: un fallo inesperado en una propuesta (por ejemplo, borraste la fuente a mitad) se anota en
    esa y el trabajo sigue con las demás."""
    base: dict = {"propuesta_id": pid, "url": None, "titulo": None, "leccion_clave": None}
    try:
        return await _tratar(pid, fuente_id, automatica, temas, base)
    except Exception as e:  # noqa: BLE001 una que falla no para las demás
        return {**base, "regla": NO_ENTRA, "motivo": motivo_de(e)}


async def _tratar(pid: int, fuente_id: int, automatica: bool, temas: dict[int, int | None], base: dict) -> dict | None:
    async with nueva_sesion() as s:
        p = await s.get(Propuesta, pid)
        if p is None:
            return None  # se fue con su plan
        base.update(url=p.url, titulo=p.titulo or p.url, leccion_clave=p.leccion_clave)
        if p.estado != "pendiente":
            ya = p.estado == "aprobada"
            return {**base, "regla": ENTRA if ya else NO_ENTRA, "version_id": p.version_id,
                    "motivo": "ya la habías guardado" if ya else "la descartaste"}
        if p.plan_id not in temas:
            plan = await dp.plan_por_id(s, p.plan_id)
            temas[p.plan_id] = plan.tema_id if plan else None
        plan_id, url = p.plan_id, p.url
        viva = await rf.version_viva_de_uri(s, url)
    vid = viva
    if vid is None:
        crudo, tipo = await ingesta.descargar(url, externa=True)
        origen = {"origen": "research", "automatica": automatica, "propuesta_id": pid, "plan_id": plan_id,
                  "leccion_clave": base["leccion_clave"]}
        vid = await ingesta.recibir(fuente_id, crudo, url, url, temas[plan_id], tipo, origen)
        await ingesta.procesar_recibida(vid)
    async with nueva_sesion() as s, s.begin():
        v = await _version_que_vale(s, vid)
        estado, motivo, vid = v.estado, v.motivo, v.id
        # Un pedazo (el resumen tras un muro de pago) entra igual, porque algo sirve, pero se dice (ADR-0020).
        incompleta = (v.metadatos or {}).get("incompleta")
        if estado == "cuarentena":
            # No entró: la propuesta sigue pendiente (no desaparece de «Propuestas por revisar») y el porqué queda
            # anotado en el trabajo.
            claro, _ = ingesta.explicar_problema(estado, motivo, True, 0)
            return {**base, "regla": NO_ENTRA, "version_id": vid, "motivo": f"{claro} ({motivo})" if motivo else claro}
        await s.execute(update(Propuesta).where(Propuesta.id == pid, Propuesta.estado == "pendiente")
                        .values(estado="aprobada", version_id=vid))
    entrada = {**base, "regla": ENTRA, "version_id": vid, "motivo": "ya estaba en tus fuentes" if viva else None}
    if incompleta:
        entrada |= {"incompleta": incompleta, "motivo": f"entró incompleta: {incompleta}"}
    return entrada


async def ejecutar(trabajo_id: int, parametros: dict) -> None:
    ids = [int(i) for i in parametros.get("ids", [])]
    automatica = bool(parametros.get("automatica"))
    async with nueva_sesion() as s:
        t = await s.get(Trabajo, trabajo_id)
        anotadas = {a.get("propuesta_id") for a in (t.avisos if t else [])}
    fuente = await rf.fuente_o_nueva(FUENTE, "web", 1)
    temas: dict[int, int | None] = {}
    await cola.fase(trabajo_id, TIPO, 0, len(ids))
    for i, pid in enumerate(ids, 1):
        if await cola.cancelado(trabajo_id):
            raise Cancelado()
        if pid not in anotadas:
            entrada = await _una(pid, fuente.id, automatica, temas)
            if entrada is not None:
                await _anotar(trabajo_id, entrada)
        await cola.fase(trabajo_id, TIPO, i, len(ids))
