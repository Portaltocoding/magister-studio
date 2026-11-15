from pathlib import Path

import pymupdf
import pytest

from magister.cerebro.contratos import Consulta, Filtros
from magister.datos import repositorio_fuentes as rf
from magister.datos.sesion import nueva_sesion
from magister.fuentes import duplicados as dup
from magister.fuentes import ingesta
from magister.fuentes.buscar import BuscadorHibrido
from magister.fuentes.extraer import extraer
from magister.fuentes.fusion import rrf
from magister.fuentes.trocear import trocear
from magister.fuentes.validar import validar

DATOS = Path(__file__).parent / "datos"


def pdf(ruta: Path, texto: str | None) -> Path:
    doc = pymupdf.open()
    pagina = doc.new_page()
    if texto:
        pagina.insert_textbox(pymupdf.Rect(50, 50, 550, 800), texto, fontsize=11)
    doc.save(ruta)
    return ruta


# Extraer y validar (sin base)


def test_markdown_frontmatter_y_enlaces() -> None:
    e = extraer(str(DATOS / "indices.md"))
    assert e.titulo == "Índices en Postgres"
    assert "tags" not in e.texto and e.metadatos["tags"]
    assert "las transacciones" in e.texto and "[[" not in e.texto


def test_html_con_trafilatura() -> None:
    e = extraer(str(DATOS / "transacciones.html"))
    assert "atomicidad" in e.texto and e.extractor.startswith("trafilatura")


def test_pdf_y_escaneado_a_cuarentena(tmp_path) -> None:
    bueno = extraer(str(pdf(tmp_path / "bueno.pdf", "Una clave primaria identifica cada fila de una tabla. " * 6)))
    assert bueno.extractor.startswith("pymupdf") and not validar(bueno)
    vacio = extraer(str(pdf(tmp_path / "vacio.pdf", None)))
    problemas = validar(vacio)
    assert problemas and problemas[0].codigo == "sin_contenido"


def test_normalizar_y_hash() -> None:
    a = dup.normalizar("Las tran-\nsacciones   son\n\n\n\nútiles")
    assert a == "Las transacciones son\n\nútiles"
    assert dup.hash_texto(a) == dup.hash_texto(a + "\n")


def test_trocear_invariante() -> None:
    for nombre in ("indices.md", "transacciones.html"):
        e = extraer(str(DATOS / nombre))
        texto = dup.normalizar(e.texto)
        trozos = trocear(texto, e.titulo, "pdf", {"tokens": 40, "solape": 8})
        assert len(trozos) > 1
        for t in trozos:
            assert texto[t.inicio : t.fin] == t.texto
            assert t.texto_indexado.endswith(t.texto)


def test_rrf_ejemplo() -> None:
    from magister.cerebro.contratos import Recuperado

    r = lambda i, n: Recuperado(i, n, 0, "", "", "", "", 0)  # noqa: E731
    fusion = rrf([r(1, 1), r(2, 2), r(3, 3)], [r(2, 1), r(3, 2)])
    assert [x.fragmento_id for x in fusion] == [2, 3, 1]
    assert round(fusion[0].puntuacion, 4) == 0.0325


# Ingesta y búsqueda (con la base de pruebas y embeddings falsos)

pytestmark = pytest.mark.anyio


async def crear_fuente(nombre="apuntes", tipo="vault", confianza=3) -> int:
    async with nueva_sesion() as s:
        return (await rf.crear_fuente(s, nombre, tipo, confianza)).id


async def test_ingerir_dos_veces_no_duplica_y_editar_crea_version(base, tmp_path) -> None:
    fid = await crear_fuente()
    copia = tmp_path / "nota.md"
    copia.write_text((DATOS / "indices.md").read_text(encoding="utf-8"), encoding="utf-8")
    r1 = await ingesta.ingerir_ruta(fid, str(tmp_path))
    r2 = await ingesta.ingerir_ruta(fid, str(tmp_path))
    assert [r.salida for r in r1] == ["nueva"] and [r.salida for r in r2] == ["sin_cambios"]
    copia.write_text(copia.read_text(encoding="utf-8") + "\nUna frase nueva sobre índices GIN.", encoding="utf-8")
    r3 = await ingesta.ingerir_ruta(fid, str(tmp_path))
    assert r3[0].salida == "nueva"
    async with nueva_sesion() as s:
        docs = await rf.documentos_de_fuente(s, fid)
        versiones = await rf.versiones_de_documento(s, docs[0][0].id)
    assert [v.estado for v in versiones] == ["retirada", "pendiente"]


async def test_casi_duplicado_entre_fuentes(base, tmp_path) -> None:
    mia = await crear_fuente("apuntes", "pdf", 3)
    web = await crear_fuente("web", "web", 1)
    texto = (DATOS / "indices.md").read_text(encoding="utf-8")
    (tmp_path / "a.md").write_text(texto, encoding="utf-8")
    (tmp_path / "b.md").write_text(texto.replace("sirve para casi todo", "vale para casi todo"), encoding="utf-8")
    [ra] = await ingesta.ingerir_ruta(mia, str(tmp_path / "a.md"))
    [rb] = await ingesta.ingerir_ruta(web, str(tmp_path / "b.md"))
    async with nueva_sesion() as s:
        from magister.datos.fuentes import Version

        vb = await s.get(Version, rb.version_id)
    assert vb.duplicado_de == ra.version_id


async def test_indexar_y_buscar_por_las_tres_vias(base) -> None:
    fid = await crear_fuente()
    await ingesta.ingerir_ruta(fid, str(DATOS))
    assert await ingesta.procesar_pendientes() == 2
    async with nueva_sesion() as s:
        cuenta = await rf.contar(s)
    assert cuenta["versiones_listas"] == 2 and cuenta["fragmentos"] == cuenta["con_vector"] > 0
    b = BuscadorHibrido()
    lex = await b.buscar("ACID", 5, Filtros(), Consulta(via="lexica"))
    assert lex.recuperados and "ACID" in lex.recuperados[0].texto
    assert (await b.buscar("zxqwv", 5, Filtros(), Consulta(via="lexica"))).recuperados == []
    densa = await b.buscar("índice parcial", 5, Filtros(), Consulta(via="densa"))
    assert len(densa.recuperados) > 0
    assert [r.rango for r in densa.recuperados] == list(range(1, len(densa.recuperados) + 1))
    hib = await b.buscar("índices parciales", 3, Filtros(), Consulta(reranker=True))
    assert hib.busqueda_id and len(hib.recuperados) <= 3
    assert "Índices" in (await b.indice_fuentes(None))
