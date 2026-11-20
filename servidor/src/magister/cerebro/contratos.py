"""El contrato del buscador (Parte III). `flujo` y `cerebro` solo conocen esto;
`api` construye el `BuscadorHibrido` de `magister.fuentes` y lo inyecta."""

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Literal, Protocol

TipoFuente = Literal["vault", "pdf", "libro", "web", "audio"]
Escalon = Literal["lexica", "densa", "reranker", "nada"]


def titulo_para_atributo(titulo: str) -> str:
    """Un título (de una página web, por ejemplo) metido en `fuente="..."` no puede cerrar el atributo ni la etiqueta."""
    return " ".join((titulo or "").replace('"', "'").replace("<", "‹").replace(">", "›").split())

# (afirmación, frases) -> similitud de la afirmación con cada frase, entre idiomas. El `BuscadorHibrido` la ofrece
# como `similitud_frases` con el modelo de embeddings ya cargado; una lista vacía quiere decir «no disponible».
Similitud = Callable[[str, list[str]], list[float]]


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
class ResumenVersion:
    """Lo que se sabe de un documento sin leerlo entero: su título y los apartados (encabezados) que tiene."""

    version_id: int
    titulo: str
    secciones: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class Filtros:
    tema_id: int | None = None  # N devuelve los documentos del tema N y los que no tienen tema
    fuente_tipos: list[str] | None = None
    # Solo estas versiones (las que el research trajo para una lección): misma consulta, distinto filtro.
    version_ids: list[int] | None = None


@dataclass(frozen=True)
class Consulta:
    indice: str | None = None  # nombre de configuración; None = la activa
    via: Literal["densa", "lexica", "hibrida"] = "hibrida"
    n_candidatos: int = 30
    reranker: bool = False
    # Puntuar los k con el reranker aunque el coseno llegue (el apoyo de las lecciones cuenta fragmento a fragmento).
    # En el chat no: ahí solo corre si el coseno no llega (ADR-0018).
    puntuar_reranker: bool = False
    # Fragmentos (casi) iguales cuentan como uno: un fichero de relleno con la misma frase repetida no llena el top-k
    # ni el apoyo de una lección. Las evals de recuperación que comparan ids lo pueden apagar.
    colapsar_duplicados: bool = True


@dataclass
class ResultadoBusqueda:
    recuperados: list[Recuperado] = field(default_factory=list)
    busqueda_id: int | None = None
    # Similitud coseno de la vía densa por fragmento: dice si «hay fuentes» de verdad.
    similitud_densa: dict[int, float] = field(default_factory=dict)
    # La vía que se usó de verdad: la híbrida pasa a «lexica» si e5 aún no está cargado.
    via: str = "hibrida"
    # Puntuación del reranker por fragmento. Solo se calcula cuando el coseno no llega (pregunta en español, fuente en
    # inglés: ADR-0018); vacío si no corrió.
    puntuacion_reranker: dict[int, float] = field(default_factory=dict)
    # Los fragmentos que tienen todas las palabras de la consulta (el AND de la vía léxica). None: no se sabe (un
    # buscador de antes, o sin vía léxica); en la vía léxica sola, entonces, todo acierto cuenta como completo.
    lexica_completa: set[int] | None = None

    @property
    def mejor_reranker(self) -> float | None:
        puntos = [self.puntuacion_reranker[r.fragmento_id] for r in self.recuperados if r.fragmento_id in self.puntuacion_reranker]
        return max(puntos) if puntos else None

    def hay_fuentes(self, umbral: float, umbral_reranker: float) -> bool:
        """Hay fuentes si el coseno llega al umbral o, si no, el reranker supera el suyo."""
        return self.escalon(umbral, umbral_reranker) != "nada"

    def escalon(self, umbral: float, umbral_reranker: float) -> Escalon:
        """En qué escalón se resolvió: un acierto léxico, el coseno, el reranker o nada.

        El acierto léxico cuenta sin vía densa y, en la híbrida, cuando el coseno no llega pero un fragmento de una
        fuente tuya (no web; el filtro de tema ya lo deja en tu tema o sin tema) tiene todas las palabras de la
        consulta: el coseno de e5 sobre una nota larga se diluye (0,83 frente a 0,83-0,84 de lo ajeno, medido), y una
        coincidencia literal completa en tus apuntes no es ruido."""
        if not self.recuperados:
            return "nada"
        if self.mejor_similitud >= umbral:
            return "lexica" if self.via == "lexica" else "densa"
        if self.lexica_completa and any(r.fragmento_id in self.lexica_completa and r.fuente_tipo != "web"
                                        for r in self.recuperados):
            return "lexica"
        mejor = self.mejor_reranker
        return "reranker" if mejor is not None and mejor > umbral_reranker else "nada"

    @property
    def mejor_similitud(self) -> float:
        if self.via == "lexica":
            # Sin vía densa no hay coseno; un acierto léxico con todas las palabras (el AND) ya es relevante. Los que
            # solo tienen alguna (la vía léxica completa la lista con un OR) no.
            if self.lexica_completa is None:
                return 1.0 if self.recuperados else 0.0
            return 1.0 if any(r.fragmento_id in self.lexica_completa for r in self.recuperados) else 0.0
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

    # Los documentos que el alumno adjunta al chat: su título y apartados, y sus primeros fragmentos por id de versión.
    async def resumen_versiones(self, version_ids: list[int], max_secciones: int = 12) -> list[ResumenVersion]: ...

    async def primeros_fragmentos(self, version_ids: list[int], por_version: int = 3) -> list[Recuperado]: ...


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
        self.filtros: list[Filtros | None] = []
        self.params: list[Consulta | None] = []
        self.documentos: dict[int, tuple[str, list[str], list[str]]] = {}
        self.pedidos: list[tuple[str, list[int]]] = []

    async def buscar(self, consulta, k, filtros=None, params=None, consulta_original=None) -> ResultadoBusqueda:
        self.consultas.append(consulta)
        self.filtros.append(filtros)
        self.params.append(params)
        if filtros and filtros.version_ids is not None and self.documentos:
            # Restringida a esas versiones: solo sus fragmentos.
            return ResultadoBusqueda(self._trozos(filtros.version_ids, k)[:k], None)
        return ResultadoBusqueda([] if self.vacio else self.FRAGMENTOS[:k], None)

    # Para las pruebas de los adjuntos: `documentos` es {version_id: (título, [apartados], [fragmentos])}.
    async def resumen_versiones(self, version_ids, max_secciones=12) -> list[ResumenVersion]:
        self.pedidos.append(("resumen", list(version_ids)))
        return [ResumenVersion(v, self.documentos[v][0], self.documentos[v][1][:max_secciones])
                for v in version_ids if v in self.documentos]

    async def primeros_fragmentos(self, version_ids, por_version=3) -> list[Recuperado]:
        self.pedidos.append(("primeros", list(version_ids)))
        return self._trozos(version_ids, por_version)

    def _trozos(self, version_ids, por_version) -> list[Recuperado]:
        salida: list[Recuperado] = []
        for v in version_ids:
            if v in self.documentos:
                titulo, _, trozos = self.documentos[v]
                for t in trozos[:por_version]:
                    salida.append(Recuperado(9000 + len(salida), len(salida) + 1, 1.0, t, titulo, f"subida/{titulo}", "pdf", v))
        return salida

    async def indice_fuentes(self, tema_id, max_caracteres=6000) -> str:
        return "" if self.vacio else "- Apuntes BD\n- Libro BD: cap. 5 JOINs; cap. 11 Índices"
