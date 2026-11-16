"""El guion de vídeo por escenas, con el formato de `parse` de clase-magna:
una línea `[[marcador]]` abre cada escena y nada va antes del primer marcador."""

import re

from magister.cerebro.modelo import Turno, generar
from magister.cerebro.prompts import cargar
from magister.material.modelos import EntradaMaterial
from magister.tono.hallazgo import Hallazgo

PALABRAS_MINUTO = 150
ESCENAS = ("intuicion", "choque", "nombre", "teoria")
MARCADOR = re.compile(r"^\[\[(\w+)\]\]\s*$", re.M)
EXCESO = 0.15


def escenas(texto: str) -> list[tuple[str, str]]:
    marcas = list(MARCADOR.finditer(texto))
    return [(m.group(1), texto[m.end() : marcas[i + 1].start() if i + 1 < len(marcas) else len(texto)].strip())
            for i, m in enumerate(marcas)]


ESTILOS_VIDEO = {
    "clase": "Como una buena clase: cada idea se razona y se apoya en un ejemplo concreto.",
    "resumen": "Resumen rápido para repasar: lo esencial de cada escena, sin rodeos ni ejemplos largos.",
    "analogias": "Con analogías cotidianas: en la intuición y en la teoría, una comparación con algo de la vida diaria que lo haga evidente.",
    "examen": "Pensado para el examen: en la teoría, di el tipo de pregunta que suele caer y el error típico que hay que evitar.",
}


async def generar_guion(entrada: EntradaMaterial, apuntes: str, minutos: int, estilo: str = "clase",
                        concepto: str | None = None) -> str:
    nucleo = [c.nombre for c in entrada.conceptos if c.nucleo] or [c.nombre for c in entrada.conceptos]
    if concepto:
        nucleo = [concepto]
    sistema = cargar("guion").rellenar(palabras=minutos * PALABRAS_MINUTO, minutos=minutos, conceptos=", ".join(nucleo),
                                       apuntes=apuntes.split("\n# Repaso")[0][:20000],
                                       estilo=ESTILOS_VIDEO.get(estilo, ESTILOS_VIDEO["clase"]))
    texto = "".join([t async for t in generar(sistema, [Turno("usuario", "Escribe el guion.")])]).strip()
    primera = MARCADOR.search(texto)
    return texto[primera.start():] if primera else texto


def auditar_guion(texto: str, minutos: int) -> list[Hallazgo]:
    h: list[Hallazgo] = []
    primera = MARCADOR.search(texto)
    if primera is None:
        return [Hallazgo(cita=texto[:40] or "-", regla="sin_marcadores", por_que="el guion no tiene escenas", gravedad="veto")]
    if texto[: primera.start()].strip():
        h.append(Hallazgo(cita=texto[: primera.start()].strip()[:60], regla="voz_antes", por_que="hay voz antes del primer marcador",
                          gravedad="veto"))
    lista = escenas(texto)
    if not lista:
        return h
    por_escena = minutos * PALABRAS_MINUTO / len(lista)
    for nombre, cuerpo in lista:
        if nombre not in ESCENAS:
            h.append(Hallazgo(cita=f"[[{nombre}]]", regla="marcador", por_que="marcador desconocido", gravedad="aviso"))
        n = len(cuerpo.split())
        if n > por_escena * (1 + EXCESO):
            h.append(Hallazgo(cita=cuerpo[:60] or nombre, regla="duracion", por_que=f"{n} palabras para {por_escena:.0f}", gravedad="aviso"))
    return h
