"""La tubería de un trabajo de material: apuntes, preguntas, PDF, diapositivas y guion.

Cada paso es idempotente (upsert): si el trabajo se reanuda, sigue por lo que falte.
"""

from magister.config import ajustes
from magister.material import almacen
from magister.material.conceptos import enriquecer
from magister.material.diapositivas import auditar_diapositivas, generar_diapositivas, montar_marp, pintar_marp
from magister.material.entrada import entrada_de_leccion
from magister.material.generador import Cancelado, generar_apuntes
from magister.material.guion import auditar_guion, generar_guion
from magister.material.preguntas import auditar, generar_preguntas, guardar_preguntas
from magister.material.render import pintar
from magister.tono import lint
from magister.trabajos import cola

TIPOS = ("apuntes", "preguntas", "diapositivas", "guion")


async def ejecutar(trabajo_id: int, plan_id: int, clave: str, tipos: list[str], preferencias: dict | None = None) -> list[int]:
    async def progreso(nodo: str, paso: int, total: int) -> None:
        await cola.fase(trabajo_id, nodo, paso, total)

    async def parar() -> bool:
        return await cola.cancelado(trabajo_id)

    await progreso("entrada", 0, 1)
    entrada = await entrada_de_leccion(plan_id, clave)
    await enriquecer(plan_id, clave, entrada.titulo, entrada.objetivos)
    entrada = await entrada_de_leccion(plan_id, clave)
    entrada.preferencias = preferencias or {}
    materiales: list[int] = []

    mid = await almacen.nuevo_material(plan_id, clave, "apuntes", trabajo_id)
    materiales.append(mid)
    m = await almacen.material(mid)
    if m.estado == "generando":
        await generar_apuntes(mid, entrada, progreso, parar)
    m = await almacen.material(mid)
    claves = {b.clave for b in await almacen.bloques(mid)}

    if "preguntas" in tipos:
        if await parar():
            raise Cancelado()
        await progreso("preguntas", 0, 1)
        preguntas = await generar_preguntas(entrada, m.texto or "", claves)
        filas = await guardar_preguntas(entrada, mid, preguntas)
        hallazgos = auditar(filas, entrada, claves)
        for h in hallazgos:
            await cola.aviso(trabajo_id, f"preguntas.{h.regla}", h.por_que)
        await almacen.actualizar(mid, informes=[*(m.informes or []), {"nodo": "preguntas", "hallazgos": [h.model_dump() for h in hallazgos]}])
        await almacen.montar_markdown(mid)

    m = await almacen.material(mid)
    await progreso("pintar", 0, 1)
    r = await pintar(m.texto or "", plan_id, clave)
    rutas = {"md": str(almacen.carpeta_salidas(plan_id, clave) / "apuntes.md")}
    if r.pdf:
        rutas["pdf"] = str(r.pdf)
    if r.contacto:
        rutas["contacto"] = str(r.contacto)
    for a in r.avisos:
        await cola.aviso(trabajo_id, a["regla"], a["detalle"])
    cambios: dict = {"rutas": rutas, "informes": [*(m.informes or []), {"nodo": "pintar", "paginas": r.paginas, "avisos": r.avisos,
                                                                          "error": r.error}]}
    if any(a["gravedad"] == "veto" for a in r.avisos):
        cambios.update(estado="bloqueado", motivo="el PDF tiene la raya larga")
    await almacen.actualizar(mid, **cambios)

    if "diapositivas" in tipos:
        if await parar():
            raise Cancelado()
        await progreso("diapositivas", 0, 1)
        did = await almacen.nuevo_material(plan_id, clave, "diapositivas", trabajo_id)
        materiales.append(did)
        p = await generar_diapositivas(m.texto or "")
        marp = montar_marp(p, entrada.titulo)
        hallazgos = auditar_diapositivas(marp) + lint.revisar(marp, "diapositivas")
        rutas_d = await pintar_marp(marp, plan_id, clave)
        estado = "bloqueado" if lint.vetos(hallazgos) else "listo"
        await almacen.actualizar(did, texto=marp, rutas=rutas_d, estado=estado,
                                 informes=[{"nodo": "auditoria", "hallazgos": [h.model_dump() for h in hallazgos]}])

    if "guion" in tipos:
        if await parar():
            raise Cancelado()
        await progreso("guion", 0, 1)
        gid = await almacen.nuevo_material(plan_id, clave, "guion", trabajo_id)
        materiales.append(gid)
        texto = await generar_guion(entrada, m.texto or "", ajustes.duracion_guion_min)
        hallazgos = auditar_guion(texto, ajustes.duracion_guion_min) + lint.revisar(texto, "guion")
        ruta = almacen.carpeta_salidas(plan_id, clave) / "guion.md"
        ruta.write_text(texto, encoding="utf-8")
        estado = "bloqueado" if lint.vetos(hallazgos) else "listo"
        await almacen.actualizar(gid, texto=texto, rutas={"md": str(ruta)}, estado=estado,
                                 informes=[{"nodo": "auditoria", "hallazgos": [h.model_dump() for h in hallazgos]}])
    return materiales
