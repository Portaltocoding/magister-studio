"""Un extractor por formato. Sin base ni red: las URL se descargan fuera."""

import re
from dataclasses import dataclass, field
from pathlib import Path

import yaml

FORMATOS = {".pdf": "pdf", ".md": "md", ".markdown": "md", ".txt": "txt", ".html": "html", ".htm": "html"}


@dataclass
class Extraido:
    crudo: bytes
    texto: str
    metadatos: dict = field(default_factory=dict)
    extractor: str = ""
    titulo: str = ""


class FormatoNoAdmitido(Exception):
    pass


def tipo_de(nombre: str) -> str:
    sufijo = Path(nombre.split("?")[0]).suffix.lower()
    if sufijo not in FORMATOS:
        raise FormatoNoAdmitido(f"formato no admitido: {sufijo or 'sin extensión'}")
    return FORMATOS[sufijo]


ENLACE_WIKI = re.compile(r"\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]")


def _markdown(crudo: bytes, nombre: str) -> Extraido:
    texto = crudo.decode("utf-8", "replace").replace("\r\n", "\n")
    metadatos: dict = {}
    if texto.startswith("---\n"):
        fin = texto.find("\n---", 4)
        if fin != -1:
            try:
                metadatos = yaml.safe_load(texto[4:fin]) or {}
                if not isinstance(metadatos, dict):
                    metadatos = {}
            except yaml.YAMLError:
                metadatos = {}
            texto = texto[fin + 4 :].lstrip("\n")
    texto = ENLACE_WIKI.sub(lambda m: (m.group(2) or m.group(1)).strip(), texto)
    titulo = str(metadatos.get("title") or metadatos.get("titulo") or "")
    if not titulo:
        m = re.search(r"^#\s+(.+)$", texto, re.M)
        titulo = m.group(1).strip() if m else Path(nombre).stem
    return Extraido(crudo, texto, {k: str(v) for k, v in metadatos.items()}, "markdown propio", titulo)


def _pdf(crudo: bytes, nombre: str) -> Extraido:
    import pymupdf

    doc = pymupdf.open(stream=crudo, filetype="pdf")
    paginas: list[str] = []
    con_texto = 0
    for pagina in doc:
        t = pagina.get_text("text", sort=True)
        if t.strip():
            con_texto += 1
        paginas.append(t)
    meta = {k: str(v) for k, v in (doc.metadata or {}).items() if v}
    meta.update({"paginas": str(doc.page_count), "paginas_con_texto": str(con_texto)})
    titulo = meta.get("title") or Path(nombre).stem
    texto = "\n\n".join(p.strip("\n") for p in paginas)
    return Extraido(crudo, texto, meta, f"pymupdf {pymupdf.__version__}", titulo)


def _html(crudo: bytes, nombre: str) -> Extraido:
    import trafilatura

    from magister.seguridad.entrada import canonicalizar, html_a_texto

    html = html_a_texto(crudo.decode("utf-8", "replace"))
    texto = trafilatura.extract(html, include_tables=True, output_format="markdown") or ""
    meta_obj = trafilatura.extract_metadata(html)
    meta: dict = {}
    titulo = nombre
    if meta_obj is not None:
        for campo in ("title", "author", "date", "sitename", "url"):
            valor = getattr(meta_obj, campo, None)
            if valor:
                meta[campo] = str(valor)
        titulo = meta.get("title") or nombre
    return Extraido(crudo, canonicalizar(texto), meta, f"trafilatura {trafilatura.__version__}", titulo)


def _txt(crudo: bytes, nombre: str) -> Extraido:
    texto = crudo.decode("utf-8", "replace").replace("\r\n", "\n")
    return Extraido(crudo, texto, {}, "texto plano", Path(nombre).stem)


def extraer_bytes(crudo: bytes, nombre: str, tipo: str | None = None) -> Extraido:
    tipo = tipo or tipo_de(nombre)
    return {"pdf": _pdf, "md": _markdown, "html": _html, "txt": _txt}[tipo](crudo, nombre)


def extraer(uri: str) -> Extraido:
    ruta = Path(uri)
    return extraer_bytes(ruta.read_bytes(), ruta.name)
