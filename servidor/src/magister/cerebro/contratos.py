"""El contrato del buscador (Parte III). `flujo` y `cerebro` solo conocen esto;
`api` construye el `BuscadorHibrido` de `magister.fuentes` y lo inyecta."""

from dataclasses import dataclass, field
from typing import Literal, Protocol

TipoFuente = Literal["vault", "pdf", "libro", "web", "audio"]


@dataclass(frozen=True)
class Recuperado:
    fragmento_id: int
    rango: int  # desde 1
    puntuacion: float
    texto: str
    documento_titulo: str
    uri: str
    fuente_tipo: str
    version_id: int


@dataclass(frozen=True)
class Filtros:
    tema_id: int | None = None  # N devuelve los documentos del tema N y los que no tienen tema
    fuente_tipos: list[str] | None = None


@dataclass(frozen=True)
class Consulta:
    indice: str | None = None  # nombre de configuración; None = la activa
    via: Literal["densa", "lexica", "hibrida"] = "hibrida"
    n_candidatos: int = 30
    reranker: bool = False


@dataclass
class ResultadoBusqueda:
    recuperados: list[Recuperado] = field(default_factory=list)
    busqueda_id: int | None = None
    # Similitud coseno de la vía densa por fragmento: dice si «hay fuentes» de verdad.
    similitud_densa: dict[int, float] = field(default_factory=dict)
    # La vía que se usó de verdad: la híbrida pasa a «lexica» si e5 aún no está cargado.
    via: str = "hibrida"

    @property
    def mejor_similitud(self) -> float:
        if self.via == "lexica":
            # Sin vía densa no hay coseno; un acierto léxico (todas las palabras, con AND) ya es relevante.
            return 1.0 if self.recuperados else 0.0
        if self.similitud_densa:
            return max(self.similitud_densa.get(r.fragmento_id, 0.0) for r in self.recuperados) if self.recuperados else 0.0
        return max((r.puntuacion for r in self.recuperados), default=0.0)


class Buscador(Protocol):
    async def buscar(
        self,
        consulta: str,
        k: int,
        filtros: Filtros | None = None,
        params: Consulta | None = None,
        consulta_original: str | None = None,
    ) -> ResultadoBusqueda: ...

    async def indice_fuentes(self, tema_id: int | None, max_caracteres: int = 6000) -> str: ...


class BuscadorFalso:
    """Devuelve siempre los mismos tres fragmentos, con rangos 1, 2 y 3."""

    FRAGMENTOS = [
        Recuperado(101, 1, 0.91, "Una clave primaria identifica cada fila de una tabla.", "Apuntes BD", "apuntes/bd.md", "vault", 1),
        Recuperado(102, 2, 0.84, "Un índice B-tree acelera las búsquedas por rango.", "Libro BD, cap. 11", "libro-bd.pdf", "libro", 2),
        Recuperado(103, 3, 0.77, "Un JOIN combina filas de dos tablas por una condición.", "Libro BD, cap. 5", "libro-bd.pdf", "libro", 2),
    ]

    def __init__(self, vacio: bool = False) -> None:
        self.vacio = vacio
        self.consultas: list[str] = []

    async def buscar(self, consulta, k, filtros=None, params=None, consulta_original=None) -> ResultadoBusqueda:
        self.consultas.append(consulta)
        return ResultadoBusqueda([] if self.vacio else self.FRAGMENTOS[:k], None)

    async def indice_fuentes(self, tema_id, max_caracteres=6000) -> str:
        return "" if self.vacio else "- Apuntes BD\n- Libro BD: cap. 5 JOINs; cap. 11 Índices"
