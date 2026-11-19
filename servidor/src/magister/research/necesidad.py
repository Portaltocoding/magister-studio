"""El juicio barato de si una lección necesita fuentes (ADR-0021, nota del 19-11-2026).

Una lección sin `necesita_fuentes` (un plan de antes de decidirlo por lección) no se investiga «por si acaso»: antes,
la plantilla `cuando_research` (los mismos criterios que al planificar, `comun/fuentes_leccion.md`) la etiqueta. Qué
modelo lo hace lo dice `config/modelos.yaml` (`prompts.cuando_research`), no el código. La eval
`evals.cuando_research` usa esta misma entrada y este mismo esquema.
"""

from pydantic import BaseModel, Field

from magister.plan.esquemas import Necesidad

LOTE = 10  # lecciones por llamada: pocas llamadas y cada lección con su número


class EtiquetaLeccion(BaseModel):
    n: int = Field(description="El número de la lección, tal como va en la lista.")
    necesita_fuentes: Necesidad
    fuentes_por_que: str = Field(min_length=3, description="Una frase corta para el alumno.")


class Etiquetas(BaseModel):
    etiquetas: list[EtiquetaLeccion]


def entrada_de(lecciones: list[dict]) -> str:
    """Las lecciones numeradas desde 1, cada una con su tema, su título y sus objetivos."""
    partes = []
    for i, c in enumerate(lecciones, start=1):
        objetivos = "\n".join(f"   - {o}" for o in c["objetivos"])
        partes.append(f"{i}. Tema: {c['tema']}\n   Título: {c['titulo']}\n   Objetivos:\n{objetivos}")
    return "\n\n".join(partes)


def reglas_de(n: int):
    """Una entrada por lección, del 1 al n, sin repetir ni saltarse ninguna."""

    def reglas(salida: Etiquetas) -> list[str]:
        numeros = [e.n for e in salida.etiquetas]
        errores = []
        if sorted(numeros) != list(range(1, n + 1)):
            errores.append(f"tiene que haber una entrada por lección, de la 1 a la {n}, sin repetir: has dado {numeros}")
        return errores

    return reglas


async def juzgar(lecciones: list[dict]) -> dict[int, EtiquetaLeccion]:
    """Una llamada: la etiqueta de cada lección (desde 1). Lanza ErrorEstructura si la salida no vale."""
    from magister.cerebro.estructura import estructurar
    from magister.cerebro.prompts import cargar

    sistema = cargar("cuando_research").texto
    salida = await estructurar(sistema, entrada_de(lecciones), Etiquetas, reglas_de(len(lecciones)))
    return {e.n: e for e in salida.etiquetas}


async def juzgar_plan(plan_id: int, claves: list[str]) -> dict[str, str]:
    """Etiqueta las `claves` del plan que siguen sin etiqueta (de LOTE en LOTE, una llamada cada lote) y las guarda.
    Lo que hayas elegido tú entretanto no se toca. Devuelve {clave: etiqueta} de lo guardado."""
    from magister.datos import plan as dp
    from magister.datos.modelos import Tema
    from magister.datos.sesion import nueva_sesion

    async with nueva_sesion() as s:
        fila = await dp.plan_por_id(s, plan_id)
        if fila is None:
            return {}
        tema = await s.get(Tema, fila.tema_id) if fila.tema_id is not None else None
        lecs = {lec.clave: lec for lec in await dp.lecciones(s, plan_id)}
    pendientes = [lecs[c] for c in claves if c in lecs]
    guardadas: dict[str, str] = {}
    for i in range(0, len(pendientes), LOTE):
        lote = pendientes[i:i + LOTE]
        etiquetas = await juzgar([{"tema": tema.nombre if tema else "", "titulo": lec.titulo, "objetivos": lec.objetivos}
                                  for lec in lote])
        valores = {lec.clave: (etiquetas[n].necesita_fuentes, etiquetas[n].fuentes_por_que.strip())
                   for n, lec in enumerate(lote, start=1) if n in etiquetas}
        async with nueva_sesion() as s:
            guardadas.update(await dp.poner_necesidad_si_falta(s, plan_id, valores))
    return guardadas
