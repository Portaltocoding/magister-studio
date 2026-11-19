"""Pintar los apuntes a PDF con el motor de las fichas (copiado en `motor_pdf/`).

El motor solo lee un `ficha.md` en una carpeta de trabajo. El código de salida 1 no es
un fallo si hay PDF: es el aviso de la raya. Solo es fallo si no hay PDF.
"""

import asyncio
import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

from magister.config import ajustes
from magister.material.almacen import carpeta_salidas
from magister.material.plantillas import ESTILOS

MOTOR = Path(__file__).parent / "motor_pdf"
_HEX = re.compile(r"#[0-9a-fA-F]{6}")


async def color_acento(clave: str) -> str | None:
    """El acento que elegiste en la app («Afinar»): fijo, o por turnos según la lección (L3 → el tercero)."""
    from magister.datos.produccion import Ajuste
    from magister.datos.sesion import nueva_sesion

    try:
        async with nueva_sesion() as s:
            fila = await s.get(Ajuste, "acento")
    except Exception:  # noqa: BLE001 - sin base de datos (pruebas): el color de la maqueta
        return None
    v = fila.valor if fila else None
    if not isinstance(v, dict):
        return None
    color = v.get("color")
    paleta = [c for c in v.get("paleta", []) if isinstance(c, str) and _HEX.fullmatch(c)]
    n = re.sub(r"\D", "", clave)
    if v.get("modo") == "auto" and paleta and n:
        color = paleta[(int(n) - 1) % len(paleta)]
    return color if isinstance(color, str) and _HEX.fullmatch(color) else None
GIT_BIN = Path("C:/Program Files/Git/mingw64/bin")


@dataclass
class Render:
    pdf: Path | None
    contacto: Path | None
    paginas: int = 0
    avisos: list[dict] = field(default_factory=list)
    error: str | None = None


# Lo único que el render (python, pandoc, node y Chromium, que pinta HTML hecho en parte con fuentes de la web) hereda
# del entorno: lista blanca. Nada de PGPASSWORD, CLAUDE_CODE_OAUTH_TOKEN, ANTHROPIC_*, MAGISTER_* ni rutas de secretos.
_HEREDA = (
    "PATH", "HOME", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "TMPDIR", "TMP", "TEMP",
    # Windows: sin ellas Python, node o Chrome no arrancan (SYSTEMROOT) o no encuentran dónde escribir.
    "SYSTEMROOT", "SYSTEMDRIVE", "WINDIR", "COMSPEC", "PATHEXT", "USERPROFILE", "LOCALAPPDATA", "APPDATA",
    "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMDATA", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE",
    # Marp: el navegador que usa y, para que npx descargue, el proxy si lo hay.
    "CHROME_PATH", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY",
)


def entorno_minimo() -> dict:
    """El entorno de un proceso que pinta (motor del PDF, Marp): solo lo de `_HEREDA`."""
    return {k: v for k in _HEREDA if (v := os.environ.get(k)) is not None}


def _entorno(estilo: str = "libro", acento: str | None = None) -> dict:
    extra = [ajustes.pandoc, str(GIT_BIN)]
    # La maqueta del libro (practica.css), no la de las fichas generales.
    entorno = {**entorno_minimo(), "PATH": os.pathsep.join([*extra, os.environ.get("PATH", "")]), "PYTHONUTF8": "1",
               "FICHA_CSS": ESTILOS.get(estilo, "practica.css"),
               "FICHA_CHROME": ajustes.chrome, "FICHA_CHROME_ARGS": ajustes.chrome_args}
    if acento and _HEX.fullmatch(acento):
        entorno["FICHA_ACENTO"] = acento
    return entorno


def _avisos(salida: str) -> list[dict]:
    avisos = []
    for linea in salida.splitlines():
        if not linea.startswith("AVISO:"):
            continue
        detalle = linea[6:].strip()
        regla = "motor.raya" if "raya" in detalle or "—" in detalle else "motor.casi_vacia" if "casi vac" in detalle else "motor.aviso"
        avisos.append({"regla": regla, "detalle": detalle, "gravedad": "veto" if regla == "motor.raya" else "aviso"})
    return avisos


_SVG = re.compile(r"```svg[ \t]*\n(.*?)\n```", re.S)


def limpiar_svg(svg: str) -> str | None:
    """Un SVG del modelo, sin nada que se ejecute ni cargue de fuera. None si no es un SVG."""
    svg = svg.strip()
    if not (svg.startswith("<svg") and svg.endswith("</svg>")):
        return None
    svg = re.sub(r"<(script|foreignObject|iframe|object|embed)\b.*?</\1\s*>", "", svg, flags=re.S | re.I)
    svg = re.sub(r"<(script|foreignObject|iframe|object|embed|image)\b[^>]*/?>", "", svg, flags=re.I)
    svg = re.sub(r"\son\w+\s*=\s*(\"[^\"]*\"|'[^']*')", "", svg, flags=re.I)
    svg = re.sub(r"\s(xlink:)?href\s*=\s*(\"(?!#)[^\"]*\"|'(?!#)[^']*')", "", svg, flags=re.I)
    if "xmlns=" not in svg:
        svg = svg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"', 1)
    # En una sola línea: así el motor lo trata como un bloque HTML y no lo parte.
    return " ".join(svg.split())


def svg_en_linea(markdown: str) -> str:
    """Los diagramas ```svg de los apuntes, como figura dentro del PDF."""
    def figura(m: re.Match) -> str:
        limpio = limpiar_svg(m.group(1))
        return f'\n<figure class="diagrama">{limpio}</figure>\n' if limpio else ""

    return _SVG.sub(figura, markdown)


async def pintar(markdown: str, plan_id: int, clave: str, nombre: str = "apuntes", estilo: str = "libro") -> Render:
    carpeta = carpeta_salidas(plan_id, clave)
    trabajo = carpeta / f".{nombre}"
    trabajo.mkdir(exist_ok=True)
    pdf = carpeta / f"{nombre}.pdf"
    # El motor escribe en la carpeta de trabajo y el PDF nuevo sustituye al viejo de golpe al final: mientras se
    # repinta, el de antes se sigue descargando entero.
    nuevo = trabajo / f"{nombre}.pdf"
    nuevo.unlink(missing_ok=True)
    md = svg_en_linea(re.sub(r"^salida: .*$", f"salida: {pdf.as_posix()}", markdown, count=1, flags=re.M))
    (trabajo / "ficha.md").write_text(re.sub(r"^salida: .*$", f"salida: {nuevo.as_posix()}", md, count=1, flags=re.M),
                                      encoding="utf-8")
    (carpeta / f"{nombre}.md").write_text(md, encoding="utf-8")
    acento = await color_acento(clave)
    try:
        proc = await asyncio.create_subprocess_exec(
            sys.executable, str(MOTOR / "build_win.py"), str(trabajo),
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT, env=_entorno(estilo, acento), cwd=str(MOTOR),
        )
        salida, _ = await asyncio.wait_for(proc.communicate(), timeout=300)
    except (TimeoutError, OSError) as e:
        return Render(None, None, error=f"el motor de PDF no respondió: {e}")
    texto = salida.decode("utf-8", "replace")
    if not nuevo.exists():
        return Render(None, None, error=f"no salió el PDF: {texto[-600:]}")
    try:
        await asyncio.to_thread(os.replace, nuevo, pdf)
    except OSError as e:  # en Windows, si alguien lo está descargando justo ahora
        return Render(None, None, error=f"no se pudo sustituir el PDF: {e}")
    m = re.search(r"(\d+) páginas", texto)
    contacto = trabajo / "contacto.png"
    return Render(pdf, contacto if contacto.exists() else None, int(m.group(1)) if m else 0, _avisos(texto))
