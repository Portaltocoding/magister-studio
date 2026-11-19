"""Un extractor por formato. Sin base ni red: las URL se descargan fuera."""

import re
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path

import yaml

from magister.config import ajustes

FORMATOS = {".pdf": "pdf", ".md": "md", ".markdown": "md", ".txt": "txt", ".html": "html", ".htm": "html"}


@dataclass
class Extraido:
    crudo: bytes
    texto: str
    metadatos: dict = field(default_factory=dict)
    extractor: str = ""
    titulo: str = ""
    paginas: list[str] = field(default_factory=list)  # de un PDF, el texto de cada página leída


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


# El texto de un PDF hecho con LaTeX trae los acentos sueltos («Aplicaci´on», «Ingenier´ıa», «Mu˜noz»), ligaduras
# («ﬁ») y palabras partidas a fin de línea («inter-\nnational»): se recomponen, o una cita bien escrita no casa.
_ACENTOS = {"´": "́", "˜": "̃", "¨": "̈", "ˆ": "̂"}
# Solo con las letras que de verdad llevan ese acento: «it´s», con «´» de apóstrofo, se queda como está.
_ACENTO_SUELTO = re.compile(r"´([aeiouyAEIOUYı])|˜([nNaoAO])|¨([aeiouyAEIOUı])|ˆ([aeiouAEIOUı])")
_LIGADURAS = re.compile("[ﬀ-ﬆ]")
_GUION_FIN = re.compile(r"(\w)-[ \t]*\n\s*([a-záéíóúñüàèìòùç])")


def _acento(m: re.Match) -> str:
    letra = next(g for g in m.groups() if g)
    return unicodedata.normalize("NFC", ("i" if letra == "ı" else letra) + _ACENTOS[m.group(0)[0]])


def recomponer(texto: str) -> str:
    """Acentos sueltos de LaTeX + letra a su letra acentuada (NFC; «´ı» es «í»), ligaduras a sus letras (NFKC solo en
    ellas: «x²» se queda) y palabras partidas con guion a fin de línea, juntas."""
    if not texto:
        return texto or ""
    t = _ACENTO_SUELTO.sub(_acento, texto)
    t = _LIGADURAS.sub(lambda m: unicodedata.normalize("NFKC", m.group(0)), t)
    return _GUION_FIN.sub(r"\1\2", t)


_PRELIMINARES = re.compile(r"^(?:índice|indice|contents|table of contents|tabla de contenidos?|agradecimientos|"
                           r"acknowledge?ments?|dedicatoria)\b", re.I)
_LINEA_DE_INDICE = re.compile(r"(?:\.\s*){4,}\d*\s*$|\S\s{3,}\d{1,4}\s*$")
PROSA_MIN = 800  # caracteres de una página para contar como cuerpo (una portada o unos agradecimientos no llegan)


def inicio_del_cuerpo(paginas: list[str]) -> int:
    """La primera página con prosa: al menos PROSA_MIN caracteres, que no empieza por «Índice», «Agradecimientos» y
    parecidos y que no está hecha de líneas de índice (puntos o espacios hasta un número de página). 0 si no hay."""
    for i, pagina in enumerate(paginas):
        lineas = [" ".join(x.split()) for x in pagina.splitlines()]
        lineas = [x for x in lineas if x]
        if not lineas or sum(len(x) + 1 for x in lineas) < PROSA_MIN or _PRELIMINARES.match(lineas[0]):
            continue
        de_indice = sum(1 for x in pagina.splitlines() if x.strip() and _LINEA_DE_INDICE.search(x.rstrip()))
        if de_indice >= max(3, len(lineas) // 5):
            continue
        return i
    return 0


def extraer_pdf(crudo: bytes, nombre: str, max_paginas: int | None = None) -> Extraido:
    """El texto de un PDF, recompuesto (`recomponer`). Con `max_paginas`, solo las primeras (al research le basta el
    principio para juzgarlo; la ingesta lo guarda entero). `paginas` es el total del documento y `paginas_con_texto`, de
    las leídas."""
    import pymupdf

    doc = pymupdf.open(stream=crudo, filetype="pdf")
    paginas: list[str] = []
    con_texto = 0
    for i, pagina in enumerate(doc):
        if max_paginas is not None and i >= max_paginas:
            break
        t = recomponer(pagina.get_text("text", sort=True))
        if t.strip():
            con_texto += 1
        paginas.append(t)
    meta = {k: str(v) for k, v in (doc.metadata or {}).items() if v}
    meta.update({"paginas": str(doc.page_count), "paginas_con_texto": str(con_texto)})
    titulo = meta.get("title") or Path(nombre.split("?")[0]).stem
    texto = "\n\n".join(p.strip("\n") for p in paginas)
    return Extraido(crudo, texto, meta, f"pymupdf {pymupdf.__version__}", titulo, paginas)


def _pdf(crudo: bytes, nombre: str) -> Extraido:
    return extraer_pdf(crudo, nombre)


def _html(crudo: bytes, nombre: str) -> Extraido:
    import trafilatura

    from magister.seguridad.entrada import canonicalizar, html_a_texto

    original = crudo.decode("utf-8", "replace")
    html = html_a_texto(original)
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
    texto = canonicalizar(texto)
    # Un pedazo (el resumen tras un muro de pago) no se tira, pero se dice: la Biblioteca lo enseña.
    incompleta = parece_incompleta(texto, titulo, nombre, html=original)
    if incompleta:
        meta["incompleta"] = incompleta
    return Extraido(crudo, texto, meta, f"trafilatura {trafilatura.__version__}", titulo)


# ¿Es el documento entero o un pedazo? Sin modelo y conservador: solo marca lo que está claro.

RESUMENES = {"abstract", "resumen", "summary", "extracto", "preview", "vista previa", "sinopsis", "highlights"}
MUROS = re.compile(
    r"access this article|buy (?:this )?article|log in via an institution|access through your institution|"
    r"rent this article|purchase (?:this article|pdf)|get access to (?:this article|the full)|"
    r"subscribe to (?:read|continue|unlock)|"
    r"subscribers? only|accede a este art[ií]culo|comprar (?:este )?art[ií]culo|comprar pdf|alquila(?:r)? este art[ií]culo|"
    r"(?:inicia sesi[oó]n|acceso) a trav[eé]s de (?:tu|su) instituci[oó]n|"
    r"obt(?:[eé]n|ener) acceso (?:a este art[ií]culo|al art[ií]culo|al texto completo)|"
    r"suscr[ií]bete para (?:leer|seguir leyendo)|solo para suscriptores|exclusivo para suscriptores",
    re.I,
)
# Las marcas del muro se buscan solo en botones y enlaces del HTML original: en el texto, «get access» o «subscribers
# only» también salen en páginas enteras («How to get access tokens»).
_BOTONES = re.compile(r"<(a|button)\b[^>]*>(.{0,300}?)</\1\s*>", re.I | re.S)


def hay_marca_de_muro(html: str | None) -> bool:
    for m in _BOTONES.finditer(html or ""):
        if MUROS.search(" ".join(re.sub(r"<[^>]+>", " ", m.group(2)).split())):
            return True
    return False


def _medir_contenido(texto: str) -> tuple[int, set[str], int]:
    """(caracteres de contenido, encabezados de contenido con texto, caracteres antes del primer encabezado). Las
    secciones de bibliografía, notas y aparato editorial son las mismas que deja fuera el troceador."""
    from magister.fuentes.trocear import SECCIONES_FUERA, _secciones, normalizar_encabezado

    fuera = {normalizar_encabezado(x) for x in SECCIONES_FUERA}
    util, preambulo = 0, 0
    encabezados: set[str] = set()
    for ini, fin, ruta in _secciones(texto):
        if any(normalizar_encabezado(h) in fuera for h in ruta):
            continue
        cuerpo = texto[ini:fin]
        if ruta:
            cuerpo = cuerpo.split("\n", 1)[1] if "\n" in cuerpo else ""
        n = len(cuerpo.strip())
        util += n
        if not ruta:
            preambulo += n
        elif n >= 80:
            encabezados.add(normalizar_encabezado(ruta[0]))
    return util, encabezados, preambulo


def parece_incompleta(texto: str, titulo: str = "", url: str = "", html: str | None = None) -> str | None:
    """El motivo si el texto parece un pedazo del documento (el resumen, las notas y la bibliografía de un artículo tras
    un muro de pago), o None. Pura y sin modelo. Señales combinadas, nunca una sola: un artículo completo con un botón
    de «Access this article» en la cabecera no se marca. `html`, si se tiene, es la página original: las marcas del
    muro se buscan solo en sus botones y enlaces (`hay_marca_de_muro`), que el extractor quita."""
    total = len(texto.strip())
    if not total:
        return None
    util, encabezados, preambulo = _medir_contenido(texto)
    proporcion = util / total
    solo_resumen = bool(encabezados) and encabezados <= RESUMENES and preambulo < 500
    muro = hay_marca_de_muro(html)
    contenido_min = ajustes.incompleta_contenido_min
    if solo_resumen and util < contenido_min:
        return "solo el resumen" + (": el artículo completo está tras un muro de pago" if muro else "")
    if muro and util < contenido_min and (proporcion < 0.5 or util < 3000):
        return "tras un muro de pago: solo deja ver el principio"
    # Mucha bibliografía sola no basta (una entrada corta de enciclopedia la tiene): hace falta un resumen o un muro.
    if total > 3000 and proporcion < 0.2 and util < 3000 and (muro or bool(encabezados & RESUMENES)):
        return "casi todo es bibliografía y notas"
    return None


_META = re.compile(r"<meta\b[^>]*>", re.I)
_ATRIBUTO = re.compile(r"""(name|property|content)\s*=\s*(?:"([^"]*)"|'([^']*)')""", re.I)
_ENLACE_PDF = re.compile(r"""<a\b[^>]*href\s*=\s*(?:"([^"]+)"|'([^']+)')[^>]*>(.{0,200}?)</a>""", re.I | re.S)
_TEXTO_PDF = re.compile(r"download pdf|full[- ]text pdf|pdf completo|descargar (?:el )?pdf|texto completo \(?pdf", re.I)
DOI = re.compile(r"\b(10\.\d{4,9}/[^\s?#\"'<>]+)")


def alternativas(html: str, url: str) -> tuple[str | None, str | None]:
    """(PDF del mismo trabajo, DOI) que anuncia la página: `citation_pdf_url` o un enlace «Download PDF», y
    `citation_doi` o el DOI de la URL. Lo que devuelve es de la web: quien lo use comprueba la dirección."""
    from urllib.parse import urljoin

    pdf = doi = None
    for m in _META.finditer(html):
        attrs = {a.group(1).lower(): (a.group(2) if a.group(2) is not None else a.group(3)) for a in _ATRIBUTO.finditer(m.group(0))}
        nombre = (attrs.get("name") or attrs.get("property") or "").lower()
        if nombre == "citation_pdf_url" and attrs.get("content") and not pdf:
            pdf = attrs["content"].strip()
        elif nombre in ("citation_doi", "dc.identifier") and attrs.get("content") and not doi:
            hallado = DOI.search(attrs["content"])
            doi = hallado.group(1) if hallado else None
    if not pdf:
        for m in _ENLACE_PDF.finditer(html):
            texto = re.sub(r"<[^>]+>", " ", m.group(3))
            if _TEXTO_PDF.search(texto):
                pdf = (m.group(1) or m.group(2)).strip()
                break
    if not doi:
        hallado = DOI.search(url)
        doi = hallado.group(1).rstrip(".") if hallado else None
    if pdf:
        pdf = urljoin(url, pdf)
        if not pdf.startswith(("http://", "https://")):
            pdf = None
    return pdf, doi


def _txt(crudo: bytes, nombre: str) -> Extraido:
    texto = crudo.decode("utf-8", "replace").replace("\r\n", "\n")
    return Extraido(crudo, texto, {}, "texto plano", Path(nombre).stem)


def extraer_bytes(crudo: bytes, nombre: str, tipo: str | None = None) -> Extraido:
    tipo = tipo or tipo_de(nombre)
    return {"pdf": _pdf, "md": _markdown, "html": _html, "txt": _txt}[tipo](crudo, nombre)


def extraer(uri: str) -> Extraido:
    ruta = Path(uri)
    return extraer_bytes(ruta.read_bytes(), ruta.name)
