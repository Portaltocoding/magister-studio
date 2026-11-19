"""La tubería de un trabajo de material: apuntes, preguntas, PDF, diapositivas y guion.

Cada paso es idempotente (upsert): si el trabajo se reanuda, sigue por lo que falte.
"""

import json

from magister.config import ajustes
from magister.material import almacen
from magister.material.conceptos import enriquecer
from magister.material.diapositivas import auditar_diapositivas, generar_diapositivas, montar_marp, pintar_marp
from magister.material.entrada import entrada_de_leccion
from magister.material.generador import Cancelado, generar_apuntes
from magister.material.guion import ESTILOS_VIDEO, auditar_guion, generar_guion
from magister.material.guion_grafico import generar_guion_grafico, por_escenas
from magister.material.preguntas import auditar, generar_preguntas, guardar_preguntas
from magister.material.render import pintar
from magister.tono import lint
from magister.trabajos import cola

TIPOS = ("apuntes", "preguntas", "diapositivas", "guion")


async def _del_tutor() -> dict:
    """Lo ajustado en la mascota que también vale para el material: instrucciones y nivel."""
    from magister.datos.produccion import Ajuste
    from magister.datos.sesion import nueva_sesion

    async with nueva_sesion() as s:
        fila = await s.get(Ajuste, "tutor")
    v = (fila.valor if fila else {}) or {}
    salida: dict = {}
    if v.get("instrucciones"):
        salida["instrucciones"] = list(v["instrucciones"])
    nivel = {"cero": "nada", "experto": "avanzado"}.get(v.get("nivel", ""))
    if nivel:
        salida["nivel_tutor"] = nivel
    # Lo aprendido de sus valoraciones («muy largo», «le falta un ejemplo» repetidos): el texto sale ya a su medida.
    from magister.datos import afinado

    try:
        aprendido = (await afinado.leer()).get("reglas") or []
    except Exception:  # noqa: BLE001  (sin lo aprendido, el material se hace igual)
        aprendido = []
    if aprendido:
        salida["aprendido"] = list(aprendido)
    return salida


async def ejecutar(trabajo_id: int, plan_id: int, clave: str, tipos: list[str], preferencias: dict | None = None) -> list[int]:
    async def progreso(nodo: str, paso: int, total: int) -> None:
        await cola.fase(trabajo_id, nodo, paso, total)

    async def parar() -> bool:
        return await cola.cancelado(trabajo_id)

    await progreso("entrada", 0, 1)
    entrada = await entrada_de_leccion(plan_id, clave)
    # Diapositivas y guion se piden aparte, con un botón: salen de los apuntes que ya tienes, sin rehacerlos.
    if not {"apuntes", "preguntas"} & set(tipos):
        previos = await almacen.ultimos_apuntes(plan_id, clave)
        if previos is None or not previos.texto:
            raise ValueError("Primero prepara la lección: las diapositivas y el guion salen de sus apuntes.")
        entrada.preferencias = preferencias or {}
        return await _extras(trabajo_id, plan_id, clave, tipos, entrada, previos.texto, progreso, parar)
    await enriquecer(plan_id, clave, entrada.titulo, entrada.objetivos)
    entrada = await entrada_de_leccion(plan_id, clave)
    entrada.preferencias = {**(preferencias or {}), **await _del_tutor()}
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

    estilo = (preferencias or {}).get("estilo", "libro")
    await almacen.montar_markdown(mid, estilo)
    m = await almacen.material(mid)
    await progreso("pintar", 0, 1)
    r = await pintar(m.texto or "", plan_id, clave, estilo=estilo)
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
    return materiales + await _extras(trabajo_id, plan_id, clave, tipos, entrada, m.texto or "", progreso, parar)


async def _extras(trabajo_id: int, plan_id: int, clave: str, tipos: list[str], entrada, texto_apuntes: str, progreso, parar) -> list[int]:
    """Diapositivas y guion a partir del texto de los apuntes."""
    materiales: list[int] = []
    if "diapositivas" in tipos:
        if await parar():
            raise Cancelado()
        await progreso("diapositivas", 0, 1)
        did = await almacen.nuevo_material(plan_id, clave, "diapositivas", trabajo_id)
        materiales.append(did)
        p = await generar_diapositivas(texto_apuntes)
        marp = montar_marp(p, entrada.titulo, clave, entrada.tema)
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
        video = (entrada.preferencias or {}).get("video") or {}
        minutos = int(video.get("minutos") or ajustes.duracion_guion_min)
        estilo = video.get("estilo", "clase")
        rutas: dict = {}
        texto = None
        # El vídeo animado (guion gráfico): si el modelo no da uno válido, sale el guion de siempre, por escenas.
        if video.get("animado", True):
            grafico = await generar_guion_grafico(entrada, texto_apuntes, minutos,
                                                  ESTILOS_VIDEO.get(estilo, ESTILOS_VIDEO["clase"]), video.get("concepto"))
            if grafico is not None:
                destino = almacen.carpeta_salidas(plan_id, clave) / f"guion_grafico-{gid}.json"
                destino.write_text(json.dumps(grafico, ensure_ascii=False), encoding="utf-8")
                rutas["grafico"] = str(destino)
                texto = por_escenas(grafico)
            else:
                # Se había pedido animado: que no parezca que el guion narrado es lo que salió bien.
                await cola.aviso(trabajo_id, "video.sin_animado", "No ha salido el vídeo animado: te dejo el guion narrado.")
        if texto is None:
            texto = await generar_guion(entrada, texto_apuntes, minutos, estilo, video.get("concepto"))
        hallazgos = auditar_guion(texto, minutos) + lint.revisar(texto, "guion")
        ruta = almacen.carpeta_salidas(plan_id, clave) / "guion.md"
        ruta.write_text(texto, encoding="utf-8")
        rutas["md"] = str(ruta)
        estado = "bloqueado" if lint.vetos(hallazgos) else "listo"
        await almacen.actualizar(gid, texto=texto, rutas=rutas, estado=estado,
                                 informes=[{"nodo": "auditoria", "hallazgos": [h.model_dump() for h in hallazgos]},
                                           {"nodo": "video", "estilo": estilo, "animado": "grafico" in rutas,
                                            "concepto": video.get("concepto"), "minutos": minutos}])
    return materiales
