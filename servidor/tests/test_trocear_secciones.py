"""v4: las notas del vault por encabezados aunque quepan y las secciones cortas juntas (ADR-0018, nota del 20-11-2026).
Sin red ni base: solo el troceador (con los embeddings falsos de las pruebas, un token por palabra o signo)."""

from magister.fuentes.embeber import contar_tokens
from magister.fuentes.trocear import trocear

V3 = {"tokens": 400, "solape": 50, "vault_por_parrafos": True, "encabezado_contextual": True, "secciones_fuera": ["notas"]}
V4 = {**V3, "vault_por_secciones": True, "seccion_minima": 50}

MEIOSIS = """# Meiosis (apuntes e6)

## Idea general
La meiosis consta de **dos divisiones sucesivas** (meiosis I y meiosis II) tras una sola replicación del ADN. De una célula diploide (2n) salen **cuatro células haploides (n)** genéticamente distintas.

## Meiosis I (reduccional)
- **Profase I**: los cromosomas homólogos se aparean (sinapsis) formando bivalentes o tétradas. Se divide en leptoteno, cigoteno, paquiteno, diploteno y diacinesis. En el paquiteno ocurre el **sobrecruzamiento** (crossing-over); los quiasmas se ven en el diploteno.
- **Metafase I**: los bivalentes se colocan en la placa ecuatorial; la orientación de cada par es al azar (segregación independiente).
- **Anafase I**: se separan los cromosomas homólogos, no las cromátidas.
- **Telofase I**: quedan dos células con n cromosomas de dos cromátidas.

## Meiosis II (ecuacional)
Se parece a una mitosis: en la **anafase II** se separan las cromátidas hermanas.

## Marca para citas
Según la ficha naranja del profesor Ruiz, un ser humano puede producir más de 8 millones de combinaciones distintas (2^23) solo por segregación independiente."""


def _invariante(texto: str, trozos) -> None:
    for t in trozos:
        assert texto[t.inicio : t.fin] == t.texto
        assert t.texto_indexado.endswith(t.texto)


def test_v3_deja_la_nota_entera_y_v4_la_parte_por_secciones() -> None:
    assert len(trocear(MEIOSIS, "Meiosis (apuntes e6)", "vault", V3)) == 1
    trozos = trocear(MEIOSIS, "Meiosis (apuntes e6)", "vault", V4)
    _invariante(MEIOSIS, trozos)
    assert len(trozos) >= 3
    # La sección que contesta a «¿en qué subfase aparecen los quiasmas?» va sola, con su ruta en lo que se embebe.
    (quiasmas,) = [t for t in trozos if "diploteno" in t.texto]
    assert quiasmas.texto.startswith("## Meiosis I (reduccional)") and "Idea general" not in quiasmas.texto
    assert "Meiosis I (reduccional)" in quiasmas.texto_indexado.split("\n")[0]
    # El encabezado suelto del principio no es un fragmento: va con la sección siguiente.
    assert not any(t.texto.strip() == "# Meiosis (apuntes e6)" for t in trozos)
    assert trozos[0].texto.startswith("# Meiosis (apuntes e6)") and "Idea general" in trozos[0].texto
    # Todo el texto útil queda cubierto, en orden y sin solaparse.
    assert all(a.fin <= b.inicio for a, b in zip(trozos, trozos[1:]))
    assert "2^23" in trozos[-1].texto


def test_las_secciones_cortas_se_juntan_sin_pasar_del_maximo() -> None:
    texto = "\n\n".join(f"## Apartado {i}\nUna línea corta del apartado {i}." for i in range(30))
    trozos = trocear(texto, "Corta", "vault", {**V4, "tokens": 60, "seccion_minima": 20})
    _invariante(texto, trozos)
    assert 1 < len(trozos) < 30
    assert all(contar_tokens(t.texto) <= 60 for t in trozos)
    assert all(contar_tokens(t.texto) >= 20 for t in trozos)
    # Sin `seccion_minima`, cada apartado sería un fragmento.
    assert len(trocear(texto, "Corta", "vault", {**V4, "tokens": 60, "seccion_minima": 0})) == 30


def test_la_ultima_corta_se_junta_con_la_anterior() -> None:
    texto = "## Larga\n" + "palabra " * 80 + "\n\n## Final\nDos palabras."
    trozos = trocear(texto, "Nota", "vault", V4)
    _invariante(texto, trozos)
    assert len(trozos) == 1 and "## Final" in trozos[0].texto
    # Si no cabe con la anterior, se queda sola: nunca por encima del máximo.
    estrecho = trocear(texto, "Nota", "vault", {**V4, "tokens": 85})
    _invariante(texto, estrecho)
    assert len(estrecho) == 2 and all(contar_tokens(t.texto) <= 85 for t in estrecho)


def test_no_se_junta_a_traves_de_una_seccion_quitada() -> None:
    texto = ("## Intro\nPoco.\n\n## Notas\n[1] Una nota al pie que no es contenido.\n\n## Cuerpo\n" + "texto " * 70)
    trozos = trocear(texto, "Web", "web", V4)
    _invariante(texto, trozos)
    assert not any("Una nota al pie" in t.texto for t in trozos)
    assert all(not ("Poco." in t.texto and "texto texto" in t.texto) for t in trozos)


def test_una_seccion_larga_se_sigue_partiendo_por_parrafos() -> None:
    parrafo = "Una frase con bastantes palabras para llenar el párrafo entero. " * 8
    texto = "# Nota\n\n## Larga\n" + "\n\n".join([parrafo] * 6)
    trozos = trocear(texto, "Nota", "vault", {**V4, "tokens": 120})
    _invariante(texto, trozos)
    assert len(trozos) > 3 and all(contar_tokens(t.texto) <= 120 for t in trozos)
