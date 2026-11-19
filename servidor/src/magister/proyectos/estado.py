"""En qué está un proyecto mientras su trabajo de la cola no ha acabado: «en cola» o «generando».

En la base el proyecto solo dice «generando» y el id de su trabajo; si está en cola o corriendo se saca del estado de
ese trabajo (sin columna nueva ni migración). Con el trabajo en cola el proyecto se sigue usando en lo que no choca con
él: marcar pasos y el diario (como siempre), y el asesor, salvo en el nivel que se va a detallar (o en la estructura
entera, si se va a rehacer). Lo que sí choca es otro trabajo del mismo proyecto (detallar otro nivel, rehacer, volver
al anterior): para eso, se cancela el de la cola. Cuando ya corre, solo se marca y se apunta en el diario.
"""

from dataclasses import dataclass

from sqlalchemy import select

from magister.datos.material import Trabajo
from magister.datos.proyectos import Proyecto

EN_COLA = "en_cola"
GENERANDO = "generando"


@dataclass
class TrabajoDelProyecto:
    id: int
    estado: str  # pendiente | en_curso
    tipo: str  # proyecto_roadmap | proyecto_nivel
    parametros: dict

    @property
    def ocupacion(self) -> str:
        return EN_COLA if self.estado == "pendiente" else GENERANDO

    @property
    def nivel(self) -> int | None:
        """El número del nivel que va a detallar (None si rehace el roadmap)."""
        return int(self.parametros["numero"]) if self.tipo == "proyecto_nivel" and "numero" in self.parametros else None

    def mismo(self, tipo: str, parametros: dict) -> bool:
        """Si es el mismo encargo (un doble clic): mismo tipo y, si detalla, el mismo nivel."""
        return self.tipo == tipo and self.nivel == (int(parametros["numero"]) if "numero" in parametros else None)


async def trabajo_de(s, p: Proyecto) -> TrabajoDelProyecto | None:
    """El trabajo de la cola que tiene el proyecto, si aún no ha acabado (en cola o en curso). None si no tiene o si
    ya acabó (falló, se canceló, se perdió): entonces el proyecto está libre aunque aún diga «generando»."""
    if p.estado != GENERANDO or p.trabajo_id is None:
        return None
    fila = (await s.execute(select(Trabajo.estado, Trabajo.tipo, Trabajo.parametros).where(Trabajo.id == p.trabajo_id))).first()
    if fila is None or fila[0] not in ("pendiente", "en_curso"):
        return None
    return TrabajoDelProyecto(p.trabajo_id, fila[0], fila[1], dict(fila[2] or {}))


def nivel_intacto(antes: dict | None, despues: dict | None, numero: int) -> bool:
    """Si el nivel con ese número queda igual (el mismo nivel, con lo mismo y en el mismo sitio): el trabajo en cola
    lo detallará por su número, así que tampoco puede correrse."""
    def nivel(r: dict | None) -> dict | None:
        return next((x for x in (r or {}).get("niveles", []) if x["numero"] == numero), None)

    return nivel(antes) == nivel(despues)
