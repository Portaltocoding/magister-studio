"""La completitud desde el generador: determinista para lo nombrado, juez solo para lo nombrado.

Por concepto: `nombrado`, `explicado`, `cita_valida`, `orden_ok`. Si la cita del juez no
aparece literal, es `FalloJuez` (no cuenta como «no explicado»).
"""

import asyncio

from pydantic import BaseModel, Field

from magister.cerebro.estructura import ErrorEstructura, estructurar
from magister.cerebro.modelo import Turno, generar
from magister.cerebro.prompts import cargar
from magister.material import almacen
from magister.material import completitud_logica as logica
from magister.material.modelos import EntradaMaterial

semaforo = asyncio.Semaphore(4)


class JuicioCompletitud(BaseModel):
    cita: str = Field(description="Frase literal de los apuntes donde se explica")
    razon: str
    explicado: bool = Field(description="true si lo define y explica su mecanismo, no solo lo nombra")


def _plano(t: str) -> str:
    return " ".join(t.split())


async def _juzgar(texto: str, concepto: dict) -> dict:
    sistema = cargar("juez_completitud").rellenar(concepto=concepto["nombre"], sinonimos=", ".join(concepto.get("sinonimos", [])),
                                                  apuntes=texto)
    async with semaforo:
        try:
            j = await estructurar(sistema, "Devuelve el juicio.", JuicioCompletitud, reintentos=1)
        except ErrorEstructura as e:
            return {"explicado": None, "cita_valida": False, "fallo_juez": str(e)}
    if _plano(j.cita) not in _plano(texto):
        return {"explicado": None, "cita_valida": False, "fallo_juez": "la cita no aparece literal"}
    return {"explicado": j.explicado, "cita_valida": True, "razon": j.razon}


async def informe_completitud(markdown: str, entrada: EntradaMaterial) -> dict:
    conceptos = [c.model_dump() for c in entrada.conceptos]
    cuerpo = markdown.split("\n# Repaso")[0]
    pos = logica.nombrados(cuerpo, conceptos)
    orden = logica.orden_ok(pos, conceptos, set(entrada.previos))
    juicios = await asyncio.gather(*(_juzgar(cuerpo, c) if pos[c["id"]] is not None else asyncio.sleep(0, {"explicado": False})
                                     for c in conceptos))
    informe = {}
    for c, j in zip(conceptos, juicios, strict=True):
        explicado = j.get("explicado")
        informe[c["id"]] = {"nombrado": pos[c["id"]] is not None, "explicado": bool(explicado) if explicado is not None else True,
                            "cita_valida": j.get("cita_valida", False), "orden_ok": orden[c["id"]], "fallo_juez": j.get("fallo_juez")}
    faltan = [c["id"] for c in conceptos if c.get("nucleo", True)
              and not (informe[c["id"]]["nombrado"] and informe[c["id"]]["explicado"])]
    return {"conceptos": informe, "faltan_nucleo": faltan, "tasas": logica.tasas(informe, conceptos)}


async def ampliar_si_falta(material_id: int, contrato: dict, faltan: list[str], entrada: EntradaMaterial) -> None:
    """Amplía el bloque que tenía asignado cada concepto que falta. Una sola ronda."""
    nombres = {c.id: c.nombre for c in entrada.conceptos}
    actuales = {b.clave: b for b in await almacen.bloques(material_id)}
    por_bloque: dict[str, list[str]] = {}
    for b in contrato.get("bloques", []):
        for cid in b["conceptos"]:
            if cid in faltan:
                por_bloque.setdefault(b["clave"], []).append(nombres.get(cid, cid))
    for clave, conceptos in por_bloque.items():
        b = actuales.get(clave)
        if b is None:
            continue
        sistema = cargar("apuntes_refinar").rellenar(
            problemas="\n".join(f"- Falta definir y explicar el mecanismo de «{c}»: añádelo." for c in conceptos), bloque=b.texto)
        texto = "".join([t async for t in generar(sistema, [Turno("usuario", "Reescribe el bloque ampliado.")])]).strip()
        await almacen.guardar_bloque(material_id, clave, b.titulo, texto, b.refinados + 1, b.marcado, b.version_prompt or "")
