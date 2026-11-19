"""Las tres herramientas del research, con efectos mínimos.

- `buscar_web` solo busca.
- `leer_pagina` solo lee URLs devueltas por `buscar_web` en la misma tarea, con plazo y
  tamaño máximos, y devuelve un extracto, nunca la página entera. Lee HTML y PDF
  (MAGISTER_RESEARCH_PDF).
- `proponer_fuente` solo apunta una propuesta: ingerirla es otro paso (ADR-0019).

Los errores se devuelven como texto («error: 404»), no como excepciones. Todo lo que
venga de la web es no confiable (también el texto de un PDF): se delimita y nunca da órdenes.
"""

import asyncio
import hashlib
import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

import httpx

from magister.config import ajustes

registro = logging.getLogger("magister.research")

MAX_PAGINA = 2 * 1024 * 1024
PLAZO = 15  # por operación de httpx (conectar, cada lectura); el tope total es MAGISTER_RESEARCH_PLAZO_*_S

# ddgs no tiene un valor de «sin región» (su documentación solo da ejemplos país-idioma como us-en y usa
# us-en por defecto): las consultas en español van con es-es y las demás con us-en.
REGION_ES = "es-es"
REGION_OTRA = "us-en"
_SENALES_ES = re.compile(r"[áéíóúñü¿¡]", re.I)
_PALABRAS_ES = {"qué", "que", "cómo", "como", "para", "con", "los", "las", "del", "una", "por", "entre", "sobre", "cuando", "donde", "de", "el"}


def region_de(consulta: str) -> str:
    """La región de búsqueda según el idioma que parece tener la consulta."""
    if _SENALES_ES.search(consulta):
        return REGION_ES
    palabras = re.findall(r"\w+", consulta.lower())
    return REGION_ES if any(p in _PALABRAS_ES for p in palabras) else REGION_OTRA


@dataclass
class Resultado:
    titulo: str
    url: str
    extracto: str


@dataclass
class Lectura:
    url: str
    titulo: str = ""
    fecha: str | None = None
    idioma: str | None = None
    longitud: int = 0
    extracto: str = ""
    error: str | None = None
    formato: str = "html"  # html o pdf
    paginas: int | None = None  # de un PDF, cuántas tiene
    crudo_sha: str | None = None  # el crudo guardado en MAGISTER_CRUDO, para rejugar sin red
    incompleta: str | None = None  # por qué parece un pedazo (fuentes.extraer.parece_incompleta)
    pdf_url: str | None = None  # el PDF del mismo trabajo que anuncia la página
    doi: str | None = None


def dominio(url: str) -> str:
    return urlparse(url).netloc.lower().removeprefix("www.")


# Segundo nivel de un país («bbc.co.uk», «uba.com.ar», «educacion.gob.es») y sitios donde cada subdominio es de otro
# dueño (un blog de GitHub Pages no es «el mismo sitio» que otro).
_SEGUNDO_NIVEL = {"co", "com", "org", "net", "gob", "gov", "edu", "ac", "nom", "mil"}
_ALOJAMIENTOS = {"github.io", "gitlab.io", "blogspot.com", "wordpress.com", "netlify.app", "vercel.app", "pages.dev",
                 "substack.com", "wixsite.com", "medium.com", "readthedocs.io"}


def dominio_base(url: str) -> str:
    """El sitio, sin subdominios: «es.khanacademy.org», «en.khanacademy.org» y «life.khanacademy.org» son
    «khanacademy.org». Para el tope de lecturas y de propuestas por sitio (antes, cada subdominio contaba aparte y se
    leyó cinco veces la misma página). Sin lista de sufijos públicos: la regla corta de arriba y sus excepciones."""
    d = dominio(url).split(":")[0]
    partes = d.split(".")
    for alojamiento in _ALOJAMIENTOS:
        if d.endswith("." + alojamiento):
            return ".".join(partes[-(alojamiento.count(".") + 2):])
    if len(partes) >= 3 and partes[-2] in _SEGUNDO_NIVEL and len(partes[-1]) == 2:
        return ".".join(partes[-3:])
    return ".".join(partes[-2:])


# Filtros gratis, antes de leer y antes del juez.

_SEGUIMIENTO = {"hl", "srsltid", "ref", "fbclid", "gclid"}


def canonica(url: str) -> str:
    """La URL sin parámetros de seguimiento (utm_*, hl, srsltid, ref, fbclid) ni #fragmento."""
    u = urlparse(url)
    query = [(k, v) for k, v in parse_qsl(u.query, keep_blank_values=True)
             if not k.lower().startswith("utm_") and k.lower() not in _SEGUIMIENTO]
    return urlunparse(u._replace(query=urlencode(query), fragment=""))


_ANUNCIOS = ("bing.com/aclick", "duckduckgo.com/y.js")
_ESPEJOS = ("devdoc.net", "deepwiki.com")
_FICHEROS = (".zip", ".docx", ".pptx", ".doc", ".ppt", ".xlsx", ".rar", ".7z", ".tar.gz", ".exe", ".dmg")


def _en_dominio(d: str, lista) -> bool:
    return any(d == x or d.endswith("." + x) for x in lista)


def descartar_url(url: str) -> str | None:
    """El motivo para no leer una URL, sin bajarla; None si se puede leer. Las listas son cortas y explicables: juzgar
    la calidad es trabajo del juez."""
    u = urlparse(url)
    d = dominio(url)
    ruta = u.path.lower()
    if any(a in (d + u.path).lower() for a in _ANUNCIOS):
        return "es un anuncio"
    if _en_dominio(d, _ESPEJOS) or d.endswith(".esdocu.com"):
        return "es un espejo de otra página"
    fuera = [x.strip().lower() for x in ajustes.research_fuera.split(",") if x.strip()]
    if _en_dominio(d, fuera):
        return f"{d} está en MAGISTER_RESEARCH_FUERA"
    if ruta.endswith(_FICHEROS):
        return "es un fichero, no una página"
    if "/commit/" in ruta or "/compare/" in ruta:
        return "es un cambio de código, no una explicación"
    if not ajustes.research_pdf and (ruta.endswith(".pdf") or "/bitstream/" in ruta or ruta.endswith("/download")):
        return "es un PDF y MAGISTER_RESEARCH_PDF está apagado"
    return None


_MURO = re.compile(r"member-only story|sign up to continue|create a free account to continue|"
                   r"suscr[ií]bete para seguir leyendo", re.I)


def hay_muro(texto: str) -> bool:
    """La página pide registrarse para seguir leyendo (Medium y parecidos)."""
    return bool(_MURO.search(texto or ""))


class Web:
    """Implementación real: ddgs para buscar y httpx con trafilatura (o pymupdf) para leer."""

    async def buscar(self, consulta: str, n: int) -> list[Resultado]:
        def _buscar() -> list[dict]:
            from ddgs import DDGS

            return list(DDGS().text(consulta, region=region_de(consulta), max_results=n))

        for intento in range(2):
            try:
                filas = await asyncio.to_thread(_buscar)
                return [Resultado(f.get("title", ""), f.get("href", ""), f.get("body", "")) for f in filas if f.get("href")]
            except Exception as e:  # noqa: BLE001 solo se reintenta una vez, por si es la red
                registro.warning("la búsqueda %r falló (intento %d): %r", consulta, intento + 1, e)
                if intento == 0:
                    await asyncio.sleep(2)
        raise RuntimeError("la búsqueda web no respondió")

    async def hay_red(self) -> bool:
        """Una búsqueda barata, sin modelo: si no responde, el research automático no gasta consultas en esta vuelta."""
        try:
            return bool(await self.buscar("wikipedia", 1))
        except Exception:  # noqa: BLE001
            return False

    async def descargar(self, url: str) -> tuple[str, bytes]:
        from magister.fuentes.ingesta import _vigilar
        from magister.seguridad.politica import comprobar_url

        await asyncio.to_thread(comprobar_url, url)
        inicio = asyncio.get_running_loop().time()
        # Cada salto (también tras una redirección) se comprueba antes de pedirlo, como en la ingesta.
        async with httpx.AsyncClient(timeout=PLAZO, follow_redirects=True, headers={"User-Agent": "Magister/0.3"},
                                     event_hooks={"request": [_vigilar]}) as c:
            async with c.stream("GET", url) as r:
                r.raise_for_status()
                await asyncio.to_thread(comprobar_url, str(r.url))
                tipo = r.headers.get("content-type", "").split(";")[0].strip().lower()
                ruta = urlparse(str(r.url)).path.lower()
                es_pdf = "pdf" in tipo or (tipo in ("", "application/octet-stream") and ruta.endswith(".pdf"))
                if es_pdf and not ajustes.research_pdf:
                    raise ValueError("es un PDF y MAGISTER_RESEARCH_PDF está apagado")
                if not es_pdf and tipo and "html" not in tipo:
                    raise ValueError("no es una página HTML ni un PDF")
                maximo = ajustes.research_pdf_max_mb * 1024 * 1024 if es_pdf else MAX_PAGINA
                trozos: list[bytes] = []
                total = 0
                async for t in r.aiter_bytes():
                    total += len(t)
                    if total > maximo:
                        raise ValueError(f"pasa de {maximo // (1024 * 1024)} MB")
                    if not es_pdf and asyncio.get_running_loop().time() - inicio > ajustes.research_plazo_html_s:
                        raise ValueError(f"la página tarda más de {ajustes.research_plazo_html_s} s")
                    trozos.append(t)
                return str(r.url), b"".join(trozos)

    async def version_abierta(self, doi: str) -> str | None:
        """La versión en abierto de un DOI según Unpaywall (solo con MAGISTER_UNPAYWALL_EMAIL), sin seguir saltos."""
        from magister.seguridad.politica import comprobar_url

        correo = ajustes.unpaywall_email.strip()
        if not correo:
            return None
        api = f"https://api.unpaywall.org/v2/{doi}"
        await asyncio.to_thread(comprobar_url, api)
        async with httpx.AsyncClient(timeout=PLAZO, follow_redirects=False, headers={"User-Agent": "Magister/0.3"}) as c:
            r = await c.get(api, params={"email": correo})
        if r.status_code != 200:
            return None
        mejor = (r.json() or {}).get("best_oa_location") or {}
        destino = mejor.get("url_for_pdf") or mejor.get("url")
        if not isinstance(destino, str) or not destino.startswith(("http://", "https://")):
            return None
        await asyncio.to_thread(comprobar_url, destino)
        return destino


@dataclass
class Herramientas:
    """Las herramientas de una tarea. `web` se inyecta: en las pruebas es una falsa."""

    web: Web
    plan_id: int
    leccion_clave: str
    tarea_id: int | None = None
    permitidas: dict[str, str] = field(default_factory=dict)  # url -> título, salidas de buscar_web
    leidas: dict[str, Lectura] = field(default_factory=dict)
    propuestas: list[dict] = field(default_factory=list)
    guardar_propuesta: object = None  # callable async (url, titulo, motivo, ficha) -> bool, inyectado

    async def buscar_web(self, consulta: str, n: int = 8) -> list[Resultado] | str:
        """Busca en la web y devuelve título, URL (sin parámetros de seguimiento) y extracto de cada resultado."""
        try:
            resultados = await self.web.buscar(consulta, n)
        except Exception as e:  # noqa: BLE001
            return f"error: {e}"
        for r in resultados:
            r.url = canonica(r.url)
            self.permitidas.setdefault(r.url, r.titulo)
        return resultados

    async def leer_pagina(self, url: str) -> Lectura:
        """Lee una página devuelta por buscar_web: título, fecha, idioma y el principio del texto."""
        if url not in self.permitidas:
            return Lectura(url, error="error: solo se pueden leer URLs devueltas por buscar_web en esta tarea")
        return await self._leer(url)

    async def _leer(self, url: str) -> Lectura:
        if url in self.leidas:
            return Lectura(url, error="error: esta página ya se leyó")
        try:
            # httpx corta por operación, no por descarga: un servidor que manda un trozo cada 10 s no cortaría nunca.
            final, crudo = await asyncio.wait_for(self.web.descargar(url), ajustes.research_plazo_descarga_s)
        except TimeoutError:
            lectura = Lectura(url, error=f"error: la descarga tardó más de {ajustes.research_plazo_descarga_s} s")
            self.leidas[url] = lectura
            return lectura
        except Exception as e:  # noqa: BLE001
            lectura = Lectura(url, error=f"error: {e}")
            self.leidas[url] = lectura
            return lectura
        if dominio(final) != dominio(url):
            lectura = Lectura(url, error=f"error: la página redirige a otro dominio ({dominio(final)})")
            self.leidas[url] = lectura
            return lectura
        sha = await asyncio.to_thread(_guardar_crudo, crudo)
        # El mismo contenido por otra dirección (Khan Academy sirve la misma página en cada subdominio): ni se vuelve a
        # sacar el texto ni llega otra vez al juez.
        igual = next((x.url for x in self.leidas.values() if x.crudo_sha == sha), None)
        if igual is not None:
            lectura = Lectura(url, error=f"error: es el mismo contenido que {igual}, ya leído", crudo_sha=sha)
            self.leidas[url] = lectura
            return lectura
        try:
            # Un PDF patológico puede atascar pymupdf: se deja de esperar (el hilo puede seguir, pero la tarea avanza).
            lectura = await asyncio.wait_for(asyncio.to_thread(_extraer, url, crudo), ajustes.research_plazo_extraer_s)
        except TimeoutError:
            lectura = Lectura(url, error=f"error: sacar el texto tardó más de {ajustes.research_plazo_extraer_s} s")
        lectura.crudo_sha = sha
        self.leidas[url] = lectura
        return lectura

    async def leer_alternativa(self, lectura: Lectura) -> Lectura | None:
        """Para una página que es un pedazo: hasta DOS alternativas gratis y sin modelo. Primero el PDF del mismo trabajo
        que anuncia la propia página; si no lo hay, falla o vuelve a ser un pedazo (el PDF de pago de Springer), la
        versión en abierto de su DOI (Unpaywall, solo con MAGISTER_UNPAYWALL_EMAIL: sin correo no se pide nada). Las
        direcciones no salieron de buscar_web, pero salen de la página leída o de Unpaywall y pasan por descartar_url y
        por comprobar_url (también en cada redirección). Devuelve la última leída, o None si no hubo ninguna."""
        alt: Lectura | None = None
        if ajustes.research_pdf and lectura.pdf_url:
            alt = await self._leer_candidata(lectura.pdf_url, lectura.titulo)
            if alt is not None and not alt.error and not alt.incompleta:
                return alt
        if lectura.doi:
            consultar = getattr(self.web, "version_abierta", None)
            abierta = None
            if consultar is not None:
                try:
                    abierta = await consultar(lectura.doi)
                except Exception as e:  # noqa: BLE001 sin alternativa, la página se queda fuera
                    registro.warning("unpaywall %s: %r", lectura.doi, e)
            if abierta:
                otra = await self._leer_candidata(abierta, lectura.titulo)
                alt = otra or alt
        return alt

    async def _leer_candidata(self, url: str, titulo: str) -> Lectura | None:
        candidata = canonica(url)
        if candidata in self.leidas:
            return None
        motivo = descartar_url(candidata)
        if motivo:
            return Lectura(candidata, error=f"error: {motivo}")
        self.permitidas.setdefault(candidata, titulo)
        alt = await self._leer(candidata)
        if not alt.titulo:
            alt.titulo = titulo
        return alt

    async def proponer_fuente(self, url: str, motivo: str, ficha: dict | None = None) -> str:
        """Propone una página leída como fuente de la lección, con su motivo. No ingiere nada."""
        if url not in self.leidas or self.leidas[url].error:
            return "error: solo se pueden proponer páginas leídas sin error"
        if any(p["url"] == url for p in self.propuestas):
            return "error: ya propuesta"
        titulo = self.leidas[url].titulo or self.permitidas.get(url, "")
        self.propuestas.append({"url": url, "titulo": titulo, "motivo": motivo, "ficha": ficha})
        if self.guardar_propuesta is not None:
            await self.guardar_propuesta(url, titulo, motivo, ficha)  # type: ignore[operator]
        return "propuesta guardada"


def _guardar_crudo(crudo: bytes) -> str:
    carpeta = Path(ajustes.crudo)
    carpeta.mkdir(parents=True, exist_ok=True)
    sha = hashlib.sha256(crudo).hexdigest()
    ruta = carpeta / sha
    if not ruta.exists():
        ruta.write_bytes(crudo)
    return sha


def _extraer(url: str, crudo: bytes) -> Lectura:
    """El texto de una página o de un PDF, con el mismo extractor que la ingesta (fuentes.extraer). Errores: poco
    texto (MAGISTER_RESEARCH_MIN_TEXTO), un muro de registro o un PDF escaneado."""
    from magister.fuentes.extraer import alternativas, extraer_bytes, extraer_pdf, inicio_del_cuerpo

    extracto_max = ajustes.research_extracto
    minimo = ajustes.research_min_texto
    if crudo[:5] == b"%PDF-":
        por_ver = ajustes.research_paginas_pdf
        try:
            # Se miran unas cuantas más para encontrar dónde empieza el cuerpo (un TFG trae portada, agradecimientos y
            # varias páginas de índice antes): el juez ve `por_ver` páginas desde ahí.
            e = extraer_pdf(crudo, url, 3 * por_ver)
        except Exception as ex:  # noqa: BLE001 un PDF roto no para el research
            return Lectura(url, formato="pdf", error=f"error: no se pudo leer el PDF ({type(ex).__name__})")
        paginas = int(e.metadatos.get("paginas", "0") or 0)
        desde = inicio_del_cuerpo(e.paginas)
        texto = compactar("\n".join(e.paginas[desde:desde + por_ver]))
        error = None
        if e.metadatos.get("paginas_con_texto") == "0":
            error = "error: el PDF es escaneado y no tiene texto"
        elif len(texto) < minimo:
            error = "error: el PDF tiene muy poco texto para estudiar"
        return Lectura(url, titulo=e.titulo, longitud=len(texto), extracto=texto[:extracto_max], error=error,
                       formato="pdf", paginas=paginas)
    e = extraer_bytes(crudo, url, "html")
    texto = e.texto
    error = None
    if len(texto) < minimo:
        error = "error: la página tiene muy poco texto para estudiar"
    elif hay_muro(texto):
        error = "error: la página pide registrarse"
    pdf_url, doi = alternativas(crudo.decode("utf-8", "replace"), url)
    return Lectura(
        url,
        titulo=e.titulo if e.titulo != url else "",
        fecha=e.metadatos.get("date"),
        longitud=len(texto),
        extracto=texto[:extracto_max],
        error=error,
        incompleta=e.metadatos.get("incompleta"),
        pdf_url=pdf_url,
        doi=doi,
    )


def compactar(texto: str) -> str:
    """Sin las líneas en blanco ni los sangrados que deja pymupdf: en el extracto del juez cabe más texto."""
    lineas = (" ".join(x.split()) for x in texto.splitlines())
    return "\n".join(x for x in lineas if x)


def neutro(texto: str) -> str:
    """Quita a un texto de la web la forma de etiqueta, para que no pueda cerrar el delimitador."""
    return (texto or "").replace("<", "‹").replace(">", "›")


def delimitar(lectura: Lectura) -> str:
    """Una lectura como dato no confiable para el prompt (una página o un PDF, igual)."""
    total = max(lectura.longitud, len(lectura.extracto))
    formato = f"PDF de {lectura.paginas} páginas" if lectura.formato == "pdf" else "página web"
    alcance = (f"las primeras páginas, {len(lectura.extracto)} caracteres" if lectura.formato == "pdf"
               else f"los primeros {len(lectura.extracto)} de {total} caracteres")
    return (
        f'<pagina_no_confiable url="{neutro(lectura.url)}">\n'
        f"Título: {neutro(lectura.titulo)}\nFecha: {neutro(lectura.fecha or 'desconocida')}\nFormato: {formato}\n"
        f"Extracto: {alcance}\n{neutro(lectura.extracto)}\n"
        "</pagina_no_confiable>"
    )
