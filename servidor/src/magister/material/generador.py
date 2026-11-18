"""El generador de apuntes:

 entrada --> contrato --> comprobar --(falla, max 2)--> contrato
                            | ok
                            v
            +--> escribir bloque i --> lint --(grave y refinados < 2)--> refinar --+
            |                           | limpio                                   |
            |                           v                                          |
            |                         juez --(suspende y refinados < 2)--> refinar -+
            |                           | aprueba, o refinados = 2 ("revisar")
            +------ (quedan bloques) <--+ aceptar
                            | no quedan
                            v
                    montar --> completitud --(falta núcleo, 1 ronda)--> ampliar --> montar

El progreso que importa (contrato y bloques aceptados) se guarda en `materiales` y
`bloques_material` con asyncpg; al arrancar se carga y se sigue por el primero que falte.

    uv run python -m magister.material.generador --plan 3 --leccion L2
"""

import argparse
import asyncio
import operator
import re
import sys
import time
from collections.abc import Awaitable, Callable
from typing import Annotated, TypedDict

from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph

from magister.cerebro.estructura import estructurar
from magister.cerebro.modelo import Turno, generar
from magister.cerebro.prompts import cargar
from magister.datos import afinado as datos_afinado
from magister.material import almacen
from magister.material.completitud import ampliar_si_falta, informe_completitud
from magister.material.entrada import EntradaMaterial, fuentes_delimitadas
from magister.material.modelos import Contrato
from magister.material.preferencias import texto as texto_preferencias
from magister.tono import confianza
from magister.tono import juez as juez_tono
from magister.tono import lint as lint_tono
from magister.tono.hallazgo import Hallazgo

MAX_REFINADOS = 2
MAX_CONTRATOS = 3

Progreso = Callable[[str, int, int], Awaitable[None]]


class Cancelado(Exception):
    pass


class EstadoApuntes(TypedDict, total=False):
    material_id: int
    entrada: dict
    contrato: dict | None
    errores_contrato: list[str]
    intentos_contrato: int
    bloques: dict[str, str]
    informes: Annotated[list[dict], operator.add]
    i: int
    texto_actual: str
    hallazgos: list[dict]
    refinados: dict[str, int]
    marcados: list[str]
    vetado: str | None
    markdown: str
    ampliado: bool


async def escribir_texto(sistema: str, pedido: str) -> str:
    texto = "".join([t async for t in generar(sistema, [Turno("usuario", pedido)])]).strip()
    # El título del bloque lo pone el código: si el modelo lo repite como encabezado, se quita.
    return re.sub(r"\A\s*#{1,6}[^\n]*\n+", "", texto).strip()


def comprobar_contrato(contrato: Contrato, entrada: EntradaMaterial) -> list[str]:
    errores = []
    asignados = {c: i for i, b in enumerate(contrato.bloques) for c in b.conceptos}
    for c in entrada.conceptos:
        if c.id not in asignados:
            errores.append(f"el concepto «{c.id}» no está asignado a ningún bloque")
    previos = set(entrada.previos)
    for c in entrada.conceptos:
        for d in c.depende_de:
            if d in previos or d not in asignados or c.id not in asignados:
                continue
            if asignados[d] > asignados[c.id]:
                errores.append(f"«{c.id}» se explica en b{asignados[c.id] + 1} antes que «{d}», del que depende")
    claves = [b.clave for b in contrato.bloques]
    if claves != [f"b{i}" for i in range(1, len(claves) + 1)]:
        errores.append(f"las claves de los bloques tienen que ser b1, b2... en orden (son {claves})")
    return errores


def construir(progreso: Progreso | None = None, cancelado: Callable[[], Awaitable[bool]] | None = None):
    async def avisar(nodo: str, e: EstadoApuntes) -> None:
        if cancelado is not None and await cancelado():
            raise Cancelado()
        if progreso is not None:
            total = len((e.get("contrato") or {}).get("bloques", [])) or 1
            await progreso(nodo, e.get("i", 0), total)

    async def contrato(e: EstadoApuntes) -> dict:
        await avisar("contrato", e)
        entrada = EntradaMaterial.model_validate(e["entrada"])
        conceptos = "\n".join(f"- {c.id}: {c.nombre}{' · depende de ' + ', '.join(c.depende_de) if c.depende_de else ''}"
                              for c in entrada.conceptos)
        errores = e.get("errores_contrato") or []
        sistema = cargar("apuntes_contrato").rellenar(
            tema=entrada.tema, titulo=entrada.titulo, objetivos="; ".join(entrada.objetivos), conceptos=conceptos,
            previos=", ".join(entrada.previos) or "(ninguno)", fuentes=fuentes_delimitadas(entrada, 6000),
            preferencias=texto_preferencias({"nivel": (entrada.perfil or {}).get("nivel"), **(entrada.preferencias or {})}),
            errores=("<errores_del_contrato_anterior>\n" + "\n".join(errores) + "\n</errores_del_contrato_anterior>") if errores else "",
        )
        c = await estructurar(sistema, "Devuelve el contrato.", Contrato)
        await almacen.guardar_contrato(e["material_id"], c.model_dump())
        return {"contrato": c.model_dump(), "intentos_contrato": e.get("intentos_contrato", 0) + 1}

    async def comprobar(e: EstadoApuntes) -> dict:
        errores = comprobar_contrato(Contrato.model_validate(e["contrato"]), EntradaMaterial.model_validate(e["entrada"]))
        return {"errores_contrato": errores, "informes": [{"nodo": "comprobar", "errores": errores}] if errores else []}

    def tras_comprobar(e: EstadoApuntes) -> str:
        if e.get("errores_contrato") and e.get("intentos_contrato", 0) < MAX_CONTRATOS:
            return "contrato"
        return "escribir" if _siguiente(e) is not None else "montar"

    def _siguiente(e: EstadoApuntes) -> int | None:
        bloques = (e.get("contrato") or {}).get("bloques", [])
        hechos = e.get("bloques", {})
        for i, b in enumerate(bloques):
            if b["clave"] not in hechos:
                return i
        return None

    async def escribir(e: EstadoApuntes) -> dict:
        i = _siguiente(e)
        assert i is not None
        await avisar("escribir", {**e, "i": i})
        entrada = EntradaMaterial.model_validate(e["entrada"])
        c = e["contrato"]
        b = c["bloques"][i]
        nombres = {x.id: x.nombre for x in entrada.conceptos}
        anteriores = "\n\n".join(f"## {c['bloques'][j]['titulo']}\n{e['bloques'][c['bloques'][j]['clave']]}"
                                 for j in range(i) if c["bloques"][j]["clave"] in e.get("bloques", {}))
        sistema = cargar("apuntes_bloque").rellenar(
            titulo=entrada.titulo, objetivos="; ".join(entrada.objetivos),
            bloques=" · ".join(f"{x['clave']} {x['titulo']}" for x in c["bloques"]), clave=b["clave"], titulo_bloque=b["titulo"],
            proposito=b["proposito"], conceptos=", ".join(nombres.get(x, x) for x in b["conceptos"]),
            anteriores=anteriores[-4000:] or "(es el primero)", fuentes=fuentes_delimitadas(entrada),
            preferencias=texto_preferencias({"nivel": (entrada.perfil or {}).get("nivel"), **(entrada.preferencias or {})}),
        )
        texto = await escribir_texto(sistema, "Escribe el bloque.")
        return {"i": i, "texto_actual": texto, "hallazgos": []}

    async def lint(e: EstadoApuntes) -> dict:
        await avisar("lint", e)
        clave = e["contrato"]["bloques"][e["i"]]["clave"]
        hallazgos = lint_tono.revisar(e["texto_actual"], "apuntes", clave)
        return {"hallazgos": [h.model_dump() for h in hallazgos],
                "informes": [{"nodo": "lint", "bloque": clave, "hallazgos": [h.model_dump() for h in hallazgos]}] if hallazgos else []}

    def graves(e: EstadoApuntes) -> list[dict]:
        return [h for h in e.get("hallazgos", []) if h["gravedad"] in ("veto", "aviso")]

    def tras_lint(e: EstadoApuntes) -> str:
        clave = e["contrato"]["bloques"][e["i"]]["clave"]
        if graves(e) and e.get("refinados", {}).get(clave, 0) < MAX_REFINADOS:
            return "refinar"
        return "juez"

    async def juez(e: EstadoApuntes) -> dict:
        await avisar("juez", e)
        clave = e["contrato"]["bloques"][e["i"]]["clave"]
        sospechas = [Hallazgo.model_validate(h) for h in e.get("hallazgos", []) if h["gravedad"] == "sospecha"]
        # Cuánto se juzga lo decide la confianza aprendida de tus valoraciones (tono.confianza): con sospechas del lint
        # se juzga siempre; si no, la decisión es determinista por el texto del bloque (repetir el nodo decide lo mismo).
        estado_afinado = await datos_afinado.leer()
        if not sospechas and not confianza.toca_juzgar(estado_afinado, f"{clave}:{e['texto_actual']}"):
            await datos_afinado.actualizar(lambda x: {**x, "saltadas": int(x.get("saltadas", 0)) + 1})
            return {"hallazgos": graves(e), "informes": [{"nodo": "juez", "bloque": clave, "saltado": "confianza alta"}]}
        r = await juez_tono.juzgar(e["texto_actual"], sospechas)
        if isinstance(r, juez_tono.FalloJuez):
            return {"informes": [{"nodo": "juez", "bloque": clave, "fallo_juez": r.motivo}], "hallazgos": graves(e)}
        await datos_afinado.actualizar(lambda x: confianza.registrar_juez(x, {d: getattr(r.veredicto, d).aprueba for d in confianza.DIMENSIONES}))
        suspensos = [h.model_dump() for h in r.suspensos(clave)]
        return {"hallazgos": graves(e) + suspensos,
                "informes": [{"nodo": "juez", "bloque": clave, "veredicto": r.veredicto.model_dump(), "version": r.version_prompt}]}

    def tras_juez(e: EstadoApuntes) -> str:
        clave = e["contrato"]["bloques"][e["i"]]["clave"]
        if e.get("hallazgos") and e.get("refinados", {}).get(clave, 0) < MAX_REFINADOS:
            return "refinar"
        return "aceptar"

    async def refinar(e: EstadoApuntes) -> dict:
        await avisar("refinar", e)
        clave = e["contrato"]["bloques"][e["i"]]["clave"]
        problemas = "\n".join(f"- «{h['cita']}» · {h['regla']} · {h['por_que']}" for h in e.get("hallazgos", []))
        sistema = cargar("apuntes_refinar").rellenar(problemas=problemas, bloque=e["texto_actual"])
        texto = await escribir_texto(sistema, "Reescribe el bloque.")
        refinados = dict(e.get("refinados", {}))
        refinados[clave] = refinados.get(clave, 0) + 1
        return {"texto_actual": texto, "refinados": refinados}

    async def aceptar(e: EstadoApuntes) -> dict:
        await avisar("aceptar", e)
        b = e["contrato"]["bloques"][e["i"]]
        clave = b["clave"]
        restantes = [h for h in e.get("hallazgos", [])]
        marcado = bool(restantes)
        vetos = [h for h in lint_tono.revisar(e["texto_actual"], "apuntes", clave) if h.gravedad == "veto"]
        await almacen.guardar_bloque(e["material_id"], clave, b["titulo"], e["texto_actual"], e.get("refinados", {}).get(clave, 0),
                                     marcado, cargar("apuntes_bloque").etiqueta)
        bloques = {**e.get("bloques", {}), clave: e["texto_actual"]}
        cambios: dict = {"bloques": bloques, "texto_actual": "", "hallazgos": []}
        if marcado:
            cambios["marcados"] = [*e.get("marcados", []), clave]
        if vetos:
            cambios["vetado"] = f"veto del lint en {clave}: {vetos[0].regla} «{vetos[0].cita}»"
        return cambios

    def tras_aceptar(e: EstadoApuntes) -> str:
        return "escribir" if _siguiente(e) is not None else "montar"

    async def montar(e: EstadoApuntes) -> dict:
        await avisar("montar", e)
        md = await almacen.montar_markdown(e["material_id"])
        return {"markdown": md}

    async def completitud(e: EstadoApuntes) -> dict:
        await avisar("completitud", e)
        entrada = EntradaMaterial.model_validate(e["entrada"])
        informe = await informe_completitud(e.get("markdown", ""), entrada)
        return {"informes": [{"nodo": "completitud", **informe}]}

    def tras_completitud(e: EstadoApuntes) -> str:
        ultimo = next((x for x in reversed(e.get("informes", [])) if x.get("nodo") == "completitud"), {})
        return "ampliar" if ultimo.get("faltan_nucleo") and not e.get("ampliado") else END

    async def ampliar(e: EstadoApuntes) -> dict:
        await avisar("ampliar", e)
        ultimo = next(x for x in reversed(e.get("informes", [])) if x.get("nodo") == "completitud")
        await ampliar_si_falta(e["material_id"], e["contrato"], ultimo["faltan_nucleo"], EntradaMaterial.model_validate(e["entrada"]))
        return {"ampliado": True}

    g = StateGraph(EstadoApuntes)
    for nombre, f in [("contrato", contrato), ("comprobar", comprobar), ("escribir", escribir), ("lint", lint),
                      ("juez", juez), ("refinar", refinar), ("aceptar", aceptar), ("montar", montar),
                      ("completitud", completitud), ("ampliar", ampliar)]:
        g.add_node(nombre, f)
    g.add_conditional_edges(START, lambda e: "contrato" if not e.get("contrato") else ("escribir" if _siguiente(e) is not None else "montar"),
                            ["contrato", "escribir", "montar"])
    g.add_edge("contrato", "comprobar")
    g.add_conditional_edges("comprobar", tras_comprobar, ["contrato", "escribir", "montar"])
    g.add_edge("escribir", "lint")
    g.add_conditional_edges("lint", tras_lint, ["refinar", "juez"])
    g.add_edge("refinar", "lint")
    g.add_conditional_edges("juez", tras_juez, ["refinar", "aceptar"])
    g.add_conditional_edges("aceptar", tras_aceptar, ["escribir", "montar"])
    g.add_edge("montar", "completitud")
    g.add_conditional_edges("completitud", tras_completitud, ["ampliar", END])
    g.add_edge("ampliar", "montar")
    return g.compile(checkpointer=InMemorySaver())


async def generar_apuntes(material_id: int, entrada: EntradaMaterial, progreso: Progreso | None = None,
                          cancelado=None) -> EstadoApuntes:
    """Carga lo ya aceptado del material y sigue por el primer bloque que falte."""
    contrato, bloques, marcados = await almacen.cargar_progreso(material_id)
    estado: EstadoApuntes = {"material_id": material_id, "entrada": entrada.model_dump(), "contrato": contrato,
                             "bloques": bloques, "marcados": marcados, "refinados": {}, "informes": []}
    g = construir(progreso, cancelado)
    final = await g.ainvoke(estado, {"configurable": {"thread_id": f"apuntes-{material_id}"}, "recursion_limit": 200})
    await almacen.cerrar_apuntes(material_id, final)
    return final


async def _principal(plan_id: int, clave: str) -> None:
    from magister.material.conceptos import enriquecer
    from magister.material.entrada import entrada_de_leccion

    t0 = time.perf_counter()
    entrada = await entrada_de_leccion(plan_id, clave)
    await enriquecer(plan_id, clave, entrada.titulo, entrada.objetivos)
    entrada = await entrada_de_leccion(plan_id, clave)
    material_id = await almacen.nuevo_material(plan_id, clave, "apuntes", None)
    ultimo = [time.perf_counter()]

    async def progreso(nodo: str, paso: int, total: int) -> None:
        ahora = time.perf_counter()
        print(f"  {nodo:<12} bloque {paso + 1}/{total} · {ahora - ultimo[0]:.1f} s", flush=True)
        ultimo[0] = ahora

    final = await generar_apuntes(material_id, entrada, progreso)
    ruta = await almacen.escribir_markdown(material_id)
    print(f"\nMaterial {material_id} en {time.perf_counter() - t0:.0f} s · marcados: {final.get('marcados') or 'ninguno'}")
    print(f"Markdown: {ruta}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--plan", type=int, required=True)
    ap.add_argument("--leccion", required=True)
    a = ap.parse_args()
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    asyncio.run(_principal(a.plan, a.leccion))

