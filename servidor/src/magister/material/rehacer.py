"""Rehacer un solo bloque de los apuntes «a tu manera» (más sencillo, con más ejemplos, con código...),
sin rehacer la lección entera. El resto de los bloques, las fichas y el contrato no cambian."""

import asyncio
import logging

from sqlalchemy import select

from magister.cerebro.prompts import cargar
from magister.datos.material import BloqueMaterial, Material
from magister.datos.sesion import nueva_sesion
from magister.material import almacen
from magister.material.entrada import entrada_de_leccion  # noqa: I001
from magister.material.entrada import fuentes_delimitadas
from magister.material.generador import escribir_texto
from magister.material.preferencias import texto as texto_preferencias
from magister.tono import lint as lint_tono

registro = logging.getLogger(__name__)

COMO = {
    "sencillo": "Más sencillo: frases más cortas, una idea cada vez, cada término explicado con palabras llanas antes de usarlo y una analogía cotidiana.",
    "ejemplos": "Con más ejemplos: al menos dos ejemplos concretos y distintos, uno de ellos resuelto paso a paso con cifras.",
    "codigo": "Con código: ejemplos de código cortos y comentados en el lenguaje del alumno (Python si no dice otro), donde ayuden.",
    "fondo": "Más a fondo: casos límite, el porqué de cada paso, el error típico y cómo se decide en la práctica.",
    "corto": "Más corto: la mitad de largo, solo lo esencial y un ejemplo.",
}


class NoSePuede(ValueError):
    pass


async def rehacer_bloque(material_id: int, clave: str, como: str, preferencias_tutor: dict | None = None) -> str:
    """Reescribe el bloque `clave`, lo guarda y devuelve los apuntes montados de nuevo."""
    async with nueva_sesion() as s:
        m = await s.get(Material, material_id)
        if m is None or m.tipo != "apuntes":
            raise NoSePuede("solo se pueden rehacer bloques de unos apuntes")
        bloques = (await s.scalars(select(BloqueMaterial).where(BloqueMaterial.material_id == material_id))).all()
    contrato = m.contrato or {}
    lista = contrato.get("bloques", [])
    i = next((k for k, b in enumerate(lista) if b["clave"] == clave), None)
    actual = next((b for b in bloques if b.clave == clave), None)
    if i is None or actual is None:
        raise NoSePuede("ese bloque no existe")
    textos = {b.clave: b.texto for b in bloques}
    entrada = await entrada_de_leccion(m.plan_id, m.leccion_clave)
    b = lista[i]
    nombres = {x.id: x.nombre for x in entrada.conceptos}
    anteriores = "\n\n".join(f"## {lista[j]['titulo']}\n{textos.get(lista[j]['clave'], '')}" for j in range(i))
    pref = {"nivel": (entrada.perfil or {}).get("nivel"), **(preferencias_tutor or {})}
    pedido = COMO.get(como, como)
    sistema = cargar("apuntes_bloque").rellenar(
        titulo=entrada.titulo, objetivos="; ".join(entrada.objetivos),
        bloques=" · ".join(f"{x['clave']} {x['titulo']}" for x in lista), clave=b["clave"], titulo_bloque=b["titulo"],
        proposito=b["proposito"], conceptos=", ".join(nombres.get(x, x) for x in b["conceptos"]),
        anteriores=anteriores[-4000:] or "(es el primero)", fuentes=fuentes_delimitadas(entrada),
        preferencias=texto_preferencias(pref),
    ) + (f"\n\nReescribe este bloque. Lo que pide el alumno: {pedido}\nCubre lo mismo que la versión anterior "
         f"(mismos conceptos y mismas cifras clave), cambiando la forma.\n<version_anterior>\n{actual.texto}\n</version_anterior>")
    texto = await escribir_texto(sistema, "Reescribe el bloque.")
    if not texto.strip():
        raise NoSePuede("el modelo no devolvió nada")
    hallazgos = lint_tono.revisar(texto, "apuntes", clave)
    async with nueva_sesion() as s, s.begin():
        fila = await s.get(BloqueMaterial, (material_id, clave))
        fila.texto = texto
    md = await almacen.montar_markdown(material_id)
    m2 = await almacen.material(material_id)
    informes = [*(m2.informes or []), {"nodo": "rehacer", "bloque": clave, "como": pedido[:200],
                                        "hallazgos": [h.model_dump() for h in hallazgos]}]
    await almacen.actualizar(material_id, informes=informes)
    # El PDF se repinta aparte: la lectura en pantalla ya está al día.
    asyncio.create_task(_repintar(material_id))
    return md


async def _repintar(material_id: int) -> None:
    from magister.material.render import pintar

    try:
        m = await almacen.material(material_id)
        r = await pintar(m.texto or "", m.plan_id, m.leccion_clave, estilo=almacen.estilo_de(m))
        if r.pdf:
            await almacen.actualizar(material_id, rutas={**(m.rutas or {}), "pdf": str(r.pdf)})
    except Exception:  # noqa: BLE001
        registro.exception("repintar el PDF tras rehacer un bloque")
