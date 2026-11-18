"""El círculo de la retroalimentación: tus valoraciones y los juicios alimentan la confianza (`tono.confianza`), la
confianza decide cuánto se juzga, y lo que repites al valorar se vuelve una regla de la generación.

Las reglas se guardan ya calculadas en el estado (`reglas`), para que el flujo las lea de `datos` sin importar `tono`.
"""

from magister.datos import afinado as datos_afinado
from magister.tono import confianza as cf


def _con_reglas(e: dict) -> dict:
    e["reglas"] = cf.reglas(e)
    return e


async def registrar_valoracion(bien: bool, motivos: list[str]) -> None:
    await datos_afinado.actualizar(lambda e: _con_reglas(cf.registrar_usuario(e, bien, motivos)))


async def registrar_juicio(aprobadas: dict[str, bool]) -> None:
    await datos_afinado.actualizar(lambda e: cf.registrar_juez(e, aprobadas))


async def anotar_salto() -> None:
    await datos_afinado.actualizar(lambda e: {**e, "saltadas": int(e.get("saltadas", 0)) + 1})


async def toca_juzgar(clave: str) -> bool:
    return cf.toca_juzgar(await datos_afinado.leer(), clave)


async def quitar_regla(motivo: str) -> None:
    def cambio(e: dict) -> dict:
        e = {**cf.nuevo(), **e}
        e["descartadas"] = sorted({*e.get("descartadas", []), motivo})
        return _con_reglas(e)

    await datos_afinado.actualizar(cambio)


async def estado_publico() -> dict:
    """Lo que ve el alumno: qué ha aprendido Magister, cuánto se fía en cada cosa y cuánto revisa ya."""
    e = await datos_afinado.leer()
    nombres = {"razonamiento": "Que se entienda y razone bien", "economia": "Que vaya al grano", "trato": "Que el tono sea el tuyo"}
    reglas_por_motivo = {cf.MOTIVOS[m][2]: m for m in cf.MOTIVOS if cf.MOTIVOS[m][2]}
    juzgadas, saltadas = int(e.get("juzgadas", 0)), int(e.get("saltadas", 0))
    return {
        "revisa": round(cf.muestra(e), 2),
        "dimensiones": [{"id": d, "nombre": nombres[d], "confianza": round(cf.confianza(e, d), 2)} for d in cf.DIMENSIONES],
        "reglas": [{"motivo": reglas_por_motivo.get(r), "texto": r} for r in cf.reglas(e)],
        "juzgadas": juzgadas,
        "saltadas": saltadas,
        "motivos": [{"id": m, "nombre": v[0]} for m, v in cf.MOTIVOS.items()],
    }
