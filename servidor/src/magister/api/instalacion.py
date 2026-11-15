"""Lo que se prepara una vez al arrancar: el canario de la instalación y las versiones de prompts."""

import secrets

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from magister.cerebro import prompts
from magister.config import ajustes
from magister.datos.produccion import Ajuste, PromptActivo, PromptVersion
from magister.datos.sesion import nueva_sesion


async def preparar_instalacion() -> None:
    async with nueva_sesion() as s, s.begin():
        if not ajustes.canario:
            fila = await s.get(Ajuste, "canario")
            if fila is None:
                fila = Ajuste(clave="canario", valor={"valor": "mg-" + secrets.token_hex(16)})
                s.add(fila)
            ajustes.canario = fila.valor["valor"]
    await sincronizar_prompts()


async def sincronizar_prompts() -> None:
    """Registra las plantillas del disco que no están; activa la del fichero solo si el nombre no
    tiene versión activa. Lo activo en la base manda (así se vuelve atrás sin tocar ficheros)."""
    async with nueva_sesion() as s, s.begin():
        for p in prompts.ficheros():
            await s.execute(insert(PromptVersion).values(nombre=p.nombre, version=p.version, contenido=p.texto)
                            .on_conflict_do_nothing())
            await s.execute(insert(PromptActivo).values(nombre=p.nombre, version=p.version).on_conflict_do_nothing())
        activos = (await s.execute(select(PromptActivo.nombre, PromptVersion.contenido, PromptVersion.version)
                                   .join(PromptVersion, (PromptVersion.nombre == PromptActivo.nombre)
                                         & (PromptVersion.version == PromptActivo.version)))).all()
    prompts.ACTIVAS.clear()
    for nombre, contenido, version in activos:
        prompts.ACTIVAS[nombre] = prompts.Plantilla(nombre, version, contenido)
