"""Diapositivas en Markdown de Marp. El modelo da el contenido; el formato lo monta el código.

Se pintan con `npx @marp-team/marp-cli` a HTML y a PDF (sin `--allow-local-files`).
"""

import asyncio
import re
import shutil

from pydantic import BaseModel, Field

from magister.cerebro.estructura import estructurar
from magister.cerebro.prompts import cargar
from magister.config import ajustes
from magister.material.almacen import carpeta_salidas
from magister.material.render import entorno_minimo
from magister.tono.hallazgo import Hallazgo

MAX_LINEAS, MAX_PALABRAS = 5, 16


class Diapositiva(BaseModel):
    titulo: str
    lineas: list[str] = Field(default_factory=list, max_length=5)
    tabla: str | None = None
    codigo: str | None = Field(None, description="Fragmento de código corto (como mucho 8 líneas) si ayuda; si no, null")
    clave: str | None = Field(None, description="La idea que hay que llevarse de esta diapositiva, en una frase; o null")
    nota: str


class Presentacion(BaseModel):
    diapositivas: list[Diapositiva] = Field(min_length=2, max_length=16)


async def generar_diapositivas(apuntes: str) -> Presentacion:
    cuerpo = re.split(r"\n(?:# Repaso|::: practica)", apuntes)[0]
    sistema = cargar("diapositivas").rellenar(apuntes=cuerpo[:20000])
    return await estructurar(sistema, "Devuelve las diapositivas.", Presentacion)


# El tema de las diapositivas, con la paleta del libro (practica.css): negro, amarillo y crema.
ESTILO = """
section { justify-content: flex-start !important; }
section.densa { font-size: 22px; }
section.densa h2 { font-size: 38px; margin-bottom: 20px; }
section.densa li { margin-bottom: 10px; }
section.densa pre { font-size: 17px; padding: 12px 18px; }
section.densa blockquote { font-size: 21px; padding: 12px 20px; }
section { font-family: Inter, "Segoe UI", Arial, sans-serif; background: #f8f5ee; color: #161616;
  padding: 70px 84px 60px; font-size: 27px; line-height: 1.4; justify-content: flex-start; }
header { left: 84px; top: 30px; font-size: 15px; font-weight: 700; color: #8a6d00; text-transform: uppercase; letter-spacing: .06em; }
section::after { color: #8b867b; font-size: 15px; right: 40px; bottom: 26px; }
h2 { font-size: 44px; font-weight: 800; letter-spacing: -.5px; line-height: 1.12; margin: 18px 0 30px;
  border-left: 9px solid #f2c200; padding-left: 22px; color: #161616; }
p { margin: 0 0 16px; }
ul { list-style: none; padding: 0; margin: 0 0 18px; }
li { position: relative; padding-left: 36px; margin: 0 0 16px; }
li::before { content: ""; position: absolute; left: 0; top: .42em; width: 14px; height: 14px; background: #f2c200; border-radius: 3px; }
strong { font-weight: 800; color: #161616; }
code { font-family: "JetBrains Mono", Consolas, monospace; background: #fff2b3; color: #161616; padding: 1px 7px; border-radius: 4px; font-size: .86em; }
pre { background: #141414; border-radius: 8px; padding: 18px 24px; font-size: 21px; line-height: 1.45; margin: 4px 0 18px; }
pre code { background: none; color: #ecebe6; padding: 0; font-size: inherit; }
table { border-collapse: collapse; width: 100%; font-size: 22px; margin: 4px 0 18px; }
th { text-align: left; background: none; border: 0; border-bottom: 3px solid #161616; padding: 10px 14px; font-weight: 800; }
td { background: none; border: 0; border-bottom: 1px solid #d8d3c8; padding: 10px 14px; }
table tr { background: transparent !important; }
blockquote { margin: auto 0 0; background: #141414; color: #f4f2ec; border: 0; border-left: 9px solid #f2c200;
  padding: 18px 26px; border-radius: 6px; font-size: 25px; font-weight: 600; }
blockquote p { margin: 0; }
blockquote::before, blockquote::after { content: none; }
section.portada { background: #141414; color: #d9d9d9; justify-content: center; padding-left: 96px; }
section.portada h1 { color: #fff; font-size: 66px; font-weight: 800; line-height: 1.08; letter-spacing: -1px; margin: 0 0 26px; max-width: 900px; }
section.portada h6 { color: #f2c200; font-size: 150px; font-weight: 800; line-height: .9; margin: 0 0 30px; }
section.portada p { font-size: 26px; color: #cfcfcf; border-left: 4px solid #f2c200; padding-left: 18px; }
section.portada header { display: none; }
section.mapa ol { font-size: 28px; padding-left: 0; counter-reset: n; list-style: none; }
section.mapa ol li { counter-increment: n; padding-left: 64px; margin-bottom: 18px; }
section.mapa ol li::before { content: counter(n); background: #161616; color: #f2c200; width: 42px; height: 42px; border-radius: 6px;
  top: -2px; font-weight: 800; display: flex; align-items: center; justify-content: center; font-size: 22px; }
section.cierre { background: #161616; color: #ecebe6; }
section.cierre h2 { color: #fff; }
section.cierre strong { color: #f2c200; }
"""

TERMINO = re.compile(r"^([^:`]{2,40}):\s+(.+)$")


def _linea(x: str) -> str:
    x = re.sub(r"^(?:[-•]|\*(?!\*))\s*", "", x.strip()).strip()
    m = TERMINO.match(x)
    return f"- **{m.group(1).strip('* ')}**: {m.group(2)}" if m else f"- {x}"


def _yaml(texto: str) -> str:
    return '"' + texto.replace("\\", "").replace('"', "'") + '"'


def montar_marp(p: Presentacion, titulo: str, clave: str = "", tema: str = "") -> str:
    """Portada y paginación las pone el código; el modelo da el contenido de cada diapositiva."""
    estilo = "\n".join("  " + x for x in ESTILO.strip().splitlines())
    cabecera = f"{clave} · {titulo}" if clave else titulo
    frente = f"---\nmarp: true\npaginate: true\ntheme: default\nheader: {_yaml(cabecera)}\nstyle: |\n{estilo}\n---"
    numero = "".join(ch for ch in clave if ch.isdigit())
    portada = ("<!-- _class: portada -->\n<!-- _paginate: false -->\n\n" + (f"###### {numero}\n\n" if numero else "")
               + f"# {titulo}\n\n{tema or 'Magister'}")
    partes = [portada]
    for i, d in enumerate(p.diapositivas):
        # La portada ya la pone el código: se salta la que repite el título de la lección.
        if i == 0 and d.titulo.strip().lower() == titulo.strip().lower():
            continue
        trozos = []
        if d.tabla:
            trozos.append(d.tabla.strip())
        if d.lineas and not d.tabla:
            trozos.append("\n".join(_linea(x) for x in d.lineas if x.strip()))
        if d.codigo:
            trozos.append(f"```\n{d.codigo.strip().strip('`')}\n```")
        if d.clave:
            trozos.append(f"> {d.clave.strip()}")
        clase = ""
        t = d.titulo.lower()
        if any(x in t for x in ("mapa", "qué vas a ver", "índice", "de qué va")):
            clase = "<!-- _class: mapa -->\n"
            trozos = ["\n".join(f"{n}. {x.strip().lstrip('-*0123456789. ')}" for n, x in enumerate(d.lineas, 1))] + trozos[1:]
        elif any(x in t for x in ("te llevas", "resumen", "para recordar", "cierre")):
            clase = "<!-- _class: cierre -->\n"
        # Si no cabe con el tamaño normal, la diapositiva pasa a la versión compacta.
        peso = (len(d.lineas) + 0.8 * len((d.codigo or "").strip().splitlines()) + (2 if d.clave else 0)
                + 0.9 * len((d.tabla or "").strip().splitlines()))
        if not clase and peso > 10:
            clase = "<!-- _class: densa -->\n"
        nota = d.nota.replace("-->", "->")
        partes.append(f"{clase}## {d.titulo}\n\n" + "\n\n".join(trozos) + f"\n\n<!-- {nota} -->")
    return frente + "\n\n" + "\n\n---\n\n".join(partes) + "\n"


def auditar_diapositivas(marp: str) -> list[Hallazgo]:
    hallazgos = []
    for i, d in enumerate(marp.split("\n---\n")[3:], start=1):
        sin_codigo = re.sub(r"```.*?```", "", re.sub(r"<!--.*?-->", "", d, flags=re.S), flags=re.S)
        visibles = [x for x in sin_codigo.splitlines() if x.strip() and not x.startswith(("#", ">"))]
        if "<!--" not in d:
            hallazgos.append(Hallazgo(cita=d.strip()[:60] or "-", regla="sin_nota", por_que=f"la diapositiva {i} no tiene nota", gravedad="aviso"))
        if not any(x.startswith("|") for x in visibles) and len(visibles) > MAX_LINEAS:
            hallazgos.append(Hallazgo(cita=visibles[0][:60], regla="lineas", por_que=f"{len(visibles)} líneas visibles", gravedad="aviso"))
        for x in visibles:
            if not x.startswith("|") and len(x.split()) > MAX_PALABRAS:
                hallazgos.append(Hallazgo(cita=x[:80], regla="palabras", por_que=f"{len(x.split())} palabras en una línea", gravedad="aviso"))
            if re.match(r"\s{2,}[-*]", x):
                hallazgos.append(Hallazgo(cita=x.strip()[:60], regla="anidadas", por_que="viñetas anidadas", gravedad="aviso"))
    return hallazgos


_TEXTOS_MARP = {
    "Previous slide": "Diapositiva anterior", "Next slide": "Diapositiva siguiente",
    "Toggle fullscreen (f)": "Pantalla completa (f)", "Toggle overview view (o)": "Vista general (o)",
    "Open presenter view (p)": "Vista del presentador (p)", "Close overview": "Cerrar la vista general",
}
# Dentro del iframe, las flechas, el espacio y Av/Re Pág pasan de diapositiva y no desplazan también la página de la
# app (sin esto, el navegador lleva el desplazamiento al documento de fuera). Va después de los manejadores de Marp.
_TECLAS_QUIETAS = ("<script>window.addEventListener('keydown',function(e){if(['ArrowLeft','ArrowRight','ArrowUp',"
                   "'ArrowDown',' ','PageUp','PageDown','Home','End'].indexOf(e.key)>=0)e.preventDefault()});</script>")


def castellanizar_marp(html: str) -> str:
    """Los controles del visor de Marp en castellano («Diapositiva 4 de 11», no «Page 4 of 11») y las teclas sin
    desplazar la página de fuera. Solo texto sobre el HTML que da Marp: si cambia su versión y no encaja, se queda
    como estaba."""
    html = re.sub(r"`Page \$\{([^}]+)\} of \$\{([^}]+)\}`", r"`Diapositiva ${\1} de ${\2}`", html)
    for ingles, castellano in _TEXTOS_MARP.items():
        html = html.replace(f'"{ingles}"', f'"{castellano}"')
    if _TECLAS_QUIETAS not in html:
        html = html.replace("</body>", f"{_TECLAS_QUIETAS}</body>", 1) if "</body>" in html else html + _TECLAS_QUIETAS
    return html


async def pintar_marp(marp: str, plan_id: int, clave: str) -> dict:
    carpeta = carpeta_salidas(plan_id, clave)
    md = carpeta / "diapositivas.md"
    md.write_text(marp, encoding="utf-8")
    rutas = {"md": str(md)}
    npx = shutil.which("npx") or shutil.which("npx.cmd")
    if npx is None:
        return {**rutas, "error": "no encuentro npx (Node.js)"}
    for formato in ("html", "pdf"):
        salida = carpeta / f"diapositivas.{formato}"
        try:
            proc = await asyncio.create_subprocess_exec(
                npx, "--yes", ajustes.marp, str(md), f"--{formato}", "-o", str(salida),
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT, env=entorno_minimo(),
            )
            await asyncio.wait_for(proc.communicate(), timeout=240)
        except (TimeoutError, OSError) as e:
            rutas["error"] = f"Marp no respondió: {e}"
            continue
        if salida.exists():
            rutas[formato] = str(salida)
            if formato == "html":
                html = await asyncio.to_thread(salida.read_text, encoding="utf-8")
                await asyncio.to_thread(salida.write_text, castellanizar_marp(html), encoding="utf-8")
    return rutas
