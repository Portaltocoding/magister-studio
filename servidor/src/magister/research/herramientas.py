"""Las tres herramientas del research, con efectos mínimos.

- `buscar_web` solo busca.
- `leer_pagina` solo lee URLs devueltas por `buscar_web` en la misma tarea, con plazo y
  tamaño máximos, y devuelve un extracto, nunca la página entera.
- `proponer_fuente` solo apunta una propuesta: ingerir exige tu aprobación.

Los errores se devuelven como texto («error: 404»), no como excepciones. Todo lo que
venga de la web es no confiable: se delimita y nunca da órdenes.
"""

import asyncio
import hashlib
import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlparse

import httpx

from magister.config import ajustes

registro = logging.getLogger("magister.research")

MAX_PAGINA = 2 * 1024 * 1024
PLAZO = 15
EXTRACTO = 1500

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


def dominio(url: str) -> str:
    return urlparse(url).netloc.lower().removeprefix("www.")


class Web:
    """Implementación real: ddgs para buscar y httpx con trafilatura para leer."""

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

    async def descargar(self, url: str) -> tuple[str, bytes]:
        from magister.seguridad.politica import comprobar_url

        comprobar_url(url)
        async with httpx.AsyncClient(timeout=PLAZO, follow_redirects=True, headers={"User-Agent": "Magister/0.3"}) as c:
            async with c.stream("GET", url) as r:
                r.raise_for_status()
                comprobar_url(str(r.url))
                tipo = r.headers.get("content-type", "").lower()
                if (tipo and "html" not in tipo) or (not tipo and str(r.url).lower().endswith(".pdf")):
                    raise ValueError("no es una página HTML")
                trozos: list[bytes] = []
                total = 0
                async for t in r.aiter_bytes():
                    total += len(t)
                    if total > MAX_PAGINA:
                        raise ValueError("la página pasa de 2 MB")
                    trozos.append(t)
                return str(r.url), b"".join(trozos)


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
    guardar_propuesta: object = None  # callable async (url, titulo, motivo) -> bool, inyectado

    async def buscar_web(self, consulta: str, n: int = 8) -> list[Resultado] | str:
        """Busca en la web y devuelve título, URL y extracto de cada resultado."""
        try:
            resultados = await self.web.buscar(consulta, n)
        except Exception as e:  # noqa: BLE001
            return f"error: {e}"
        for r in resultados:
            self.permitidas.setdefault(r.url, r.titulo)
        return resultados

    async def leer_pagina(self, url: str) -> Lectura:
        """Lee una página devuelta por buscar_web: título, fecha, idioma y los primeros 1.500 caracteres."""
        if url not in self.permitidas:
            return Lectura(url, error="error: solo se pueden leer URLs devueltas por buscar_web en esta tarea")
        if url in self.leidas:
            return Lectura(url, error="error: esta página ya se leyó")
        try:
            final, crudo = await self.web.descargar(url)
        except Exception as e:  # noqa: BLE001
            lectura = Lectura(url, error=f"error: {e}")
            self.leidas[url] = lectura
            return lectura
        if dominio(final) != dominio(url):
            lectura = Lectura(url, error=f"error: la página redirige a otro dominio ({dominio(final)})")
            self.leidas[url] = lectura
            return lectura
        carpeta = Path(ajustes.crudo)
        carpeta.mkdir(parents=True, exist_ok=True)
        (carpeta / hashlib.sha256(crudo).hexdigest()).write_bytes(crudo)
        lectura = await asyncio.to_thread(_extraer, url, crudo)
        self.leidas[url] = lectura
        return lectura

    async def proponer_fuente(self, url: str, motivo: str) -> str:
        """Propone una página leída como fuente de la lección, con su motivo. No ingiere nada."""
        if url not in self.leidas or self.leidas[url].error:
            return "error: solo se pueden proponer páginas leídas sin error"
        if any(p["url"] == url for p in self.propuestas):
            return "error: ya propuesta"
        titulo = self.leidas[url].titulo or self.permitidas.get(url, "")
        self.propuestas.append({"url": url, "titulo": titulo, "motivo": motivo})
        if self.guardar_propuesta is not None:
            await self.guardar_propuesta(url, titulo, motivo)  # type: ignore[operator]
        return "propuesta guardada"


def _extraer(url: str, crudo: bytes) -> Lectura:
    import trafilatura

    from magister.seguridad.entrada import html_a_texto

    html = html_a_texto(crudo.decode("utf-8", "replace"))
    texto = trafilatura.extract(html) or ""
    meta = trafilatura.extract_metadata(html)
    return Lectura(
        url,
        titulo=(getattr(meta, "title", None) or "") if meta else "",
        fecha=(getattr(meta, "date", None)) if meta else None,
        idioma=(getattr(meta, "language", None)) if meta else None,
        longitud=len(texto),
        extracto=texto[:EXTRACTO],
        error=None if len(texto) > 200 else "error: la página no tiene texto aprovechable",
    )


def neutro(texto: str) -> str:
    """Quita a un texto de la web la forma de etiqueta, para que no pueda cerrar el delimitador."""
    return (texto or "").replace("<", "‹").replace(">", "›")


def delimitar(lectura: Lectura) -> str:
    """Una lectura como dato no confiable para el prompt."""
    total = max(lectura.longitud, len(lectura.extracto))
    return (
        f'<pagina_no_confiable url="{lectura.url}">\n'
        f"Título: {neutro(lectura.titulo)}\nFecha: {neutro(lectura.fecha or 'desconocida')}\n"
        f"Extracto: los primeros {len(lectura.extracto)} de {total} caracteres\n{neutro(lectura.extracto)}\n"
        "</pagina_no_confiable>"
    )
