"""Motor de las fichas de estudio: ficha.md (pandoc markdown) -> ficha.html -> PDF, más comprobaciones.

Uso: python3 build.py <carpeta de la ficha>
La carpeta tiene ficha.md con front matter YAML: titulo, pie, salida (ruta del PDF).
Convenciones del markdown en GUIA.md.
"""
import os, re, sys, subprocess, html as H, glob, shutil
from PIL import Image

MOTOR = os.path.dirname(os.path.abspath(__file__))
KATEX = os.path.join(MOTOR, "katex")

def meta(md):
    m = re.match(r"---\n(.*?)\n---\n", md, re.S)
    assert m, "falta el front matter YAML"
    return {k.strip(): v.strip().strip('"') for k, v in (l.split(":", 1) for l in m.group(1).splitlines() if ":" in l)}

TIPOS = ("planteamiento", "teoria", "practica", "referencia")
NOMBRE_TIPO = {"planteamiento": "Planteamiento", "teoria": "Teoría", "practica": "Práctica", "referencia": "Referencia"}

def marcar_tipos(body):
    """Pone en cada h2 la clase del bloque ::: planteamiento / teoria / practica que lo contiene."""
    out, pila, pos = [], [], 0
    for m in re.finditer(r"<(?:div|section)([^>]*)>|</(?:div|section)>|<h2([^>]*)>", body):
        out.append(body[pos:m.start()]); pos = m.end(); t = m.group(0)
        if t.startswith("<div") or t.startswith("<section"):
            cls = re.search(r'class="([^"]*)"', m.group(1) or "")
            pila.append(next((c for c in (cls.group(1).split() if cls else []) if c in TIPOS), None))
        elif t in ("</div>", "</section>"):
            if pila: pila.pop()
        else:
            tipo = next((c for c in reversed(pila) if c), None)
            if tipo:
                attrs = m.group(2)
                if 'class="' in attrs:
                    attrs = attrs.replace('class="', f'class="{tipo} ', 1)
                else:
                    attrs += f' class="{tipo}"'
                t = f"<h2{attrs}>"
        out.append(t)
    out.append(body[pos:])
    return "".join(out)

def slug(t):
    import unicodedata
    t = unicodedata.normalize("NFD", t.strip().lower())
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", "-", t).strip("-")


def poner_tags(body):
    """Un h2 con tags="IA, RAG" lleva debajo del título sus etiquetas temáticas como píldoras."""
    def _t(m):
        tags = re.search(r'data-tags="([^"]*)"', m.group(1))
        if not tags:
            return m.group(0)
        pills = "".join(f'<span class="t-{slug(t)}">{H.escape(t.strip())}</span>' for t in tags.group(1).split(",") if t.strip())
        return m.group(0) + f'<p class="tags">{pills}</p>'
    return re.sub(r"<h2([^>]*)>.*?</h2>", _t, body, flags=re.S)

def index(body):
    items, hay = [], set()
    for lvl, attrs, inner in re.findall(r"<h([12])([^>]*)>(.*?)</h\1>", body, re.S):
        if "noidx" in attrs:
            continue
        hid = re.search(r'id="([^"]+)"', attrs).group(1)
        txt = re.sub(r"<[^>]+>", "", inner)
        tipo = next((t for t in TIPOS if re.search(rf'class="[^"]*\b{t}\b', attrs)), "")
        if tipo: hay.add(tipo)
        items.append(f'<li class="l{lvl} {tipo}"><span class="t">{txt}</span><span class="pg" data-for="{hid}">?</span></li>')
    leyenda = ""
    if hay:
        leyenda = '<p class="leyenda">' + "".join(f'<span class="{t}">{NOMBRE_TIPO[t]}</span>' for t in TIPOS if t in hay) + "</p>"
    return leyenda + '<ul class="idx">' + "".join(items) + "</ul>"

def lines(n):
    return '<div class="lines">' + '<div class="ln"></div>' * int(n) + "</div>"

def to_html(md, m):
    md = re.sub(r"\A---\n.*?\n---\n", "", md, flags=re.S)   # el front matter lo lee meta(), no pandoc
    r = subprocess.run(["pandoc", "-f", "markdown", "-t", "html5", "--katex", "--wrap=none"],
                       input=md, capture_output=True, text=True, encoding="utf8")
    if r.returncode:
        sys.exit("pandoc: " + r.stderr)
    body = r.stdout
    # pandoc no da id a los títulos que empiezan por número («# 2. La arquitectura»): se lo ponemos
    n = [0]
    def _id(m):
        if 'id="' in m.group(2):
            return m.group(0)
        n[0] += 1
        return f'<h{m.group(1)}{m.group(2)} id="t-{n[0]}">'
    body = re.sub(r"<h([12])([^>]*)>", _id, body)
    body = marcar_tipos(body)
    body = poner_tags(body)
    # fila elegida de una tabla: la que lleva ★ pasa a clase «elegida» (resaltada en verde)
    body = re.sub(r"<tr>(?=(?:(?!</tr>).)*★)", '<tr class="elegida">', body, flags=re.S)
    body = re.sub(r"<tr>(?=(?:(?!</tr>).)*⚠)", '<tr class="peligro">', body, flags=re.S)
    body = re.sub(r"(<td[^>]*>)\s*[★⚠]\s*", lambda m: m.group(1), body)   # el marcador solo sirve para pintar la fila
    body = re.sub(r"<p>\[\[(\d+)\]\]</p>", lambda x: lines(x.group(1)), body)
    body = re.sub(r"\[\[(\d+)\]\]", lambda x: lines(x.group(1)), body)
    body = body.replace("<p>[[INDICE]]</p>", index(body))
    body = body.replace('<input type="checkbox" disabled="" />', '<span class="chk"></span>')
    css = open(os.path.join(MOTOR, os.environ.get("FICHA_CSS", "ficha.css")), encoding="utf8").read()
    return f"""<!doctype html><html lang="es"><head><meta charset="utf-8"><title>{H.escape(m['titulo'])}</title>
<link rel="stylesheet" href="file:///{KATEX.replace(chr(92), "/")}/katex.min.css"><style>{css}</style>
<script src="file:///{KATEX.replace(chr(92), "/")}/katex.min.js"></script></head><body>{body}
<script>
try {{
  document.querySelectorAll('span.math').forEach(e => {{
    const d = e.classList.contains('display');
    const t = e.textContent.replace(/^\\\\[\\(\\[]/, '').replace(/\\\\[\\)\\]]$/, '');
    katex.render(t, e, {{ displayMode: d, throwOnError: false, strict: false }});
  }});
  window.__listo = true;
}} catch (err) {{ window.__listo = String(err); }}
</script></body></html>"""

def fill_report(pdf, work):
    prev = os.path.join(work, "prev")
    shutil.rmtree(prev, ignore_errors=True)
    os.makedirs(prev)
    import fitz
    d = fitz.open(pdf)
    for i, pg in enumerate(d, 1):
        pg.get_pixmap(dpi=40).save(os.path.join(prev, f"p-{i:03d}.png"))
    pngs = sorted(glob.glob(os.path.join(prev, "p-*.png")))
    warn = []
    for i, p in enumerate(pngs, 1):
        im = Image.open(p).convert("L")
        w, h = im.size
        body = im.crop((0, 0, w, int(h * 0.93)))            # fuera el pie
        bb = body.point(lambda v: 255 if v < 235 else 0).getbbox()
        fill = (bb[3] / body.size[1]) if bb else 0
        if fill < 0.40 and i != len(pngs):
            warn.append(f"p. {i}: casi vacía (ocupa {fill:.0%})")
    ims = [Image.open(p) for p in pngs]
    w, h = ims[0].size; cols = 6; rows = -(-len(ims) // cols)
    sheet = Image.new("RGB", (cols * (w + 6) + 6, rows * (h + 6) + 6), "#999")
    for k, im in enumerate(ims):
        sheet.paste(im, (6 + (k % cols) * (w + 6), 6 + (k // cols) * (h + 6)))
    sheet.save(os.path.join(work, "contacto.png"))
    return len(pngs), warn

def main(work):
    work = os.path.abspath(work)
    md = open(os.path.join(work, "ficha.md"), encoding="utf8").read()
    m = meta(md)
    problems = []
    if "—" in md:
        problems.append(f"hay {md.count('—')} rayas «—» en ficha.md")
    html = to_html(md, m)
    hp = os.path.join(work, "ficha.html")
    open(hp, "w", encoding="utf8").write(html)
    out = os.path.expanduser(m["salida"])
    os.makedirs(os.path.dirname(out), exist_ok=True)
    subprocess.run(["node", os.path.join(MOTOR, "render_win.mjs"), hp, out, m.get("pie", m["titulo"])], check=True, timeout=240)
    txt = subprocess.run(["pdftotext", "-enc", "UTF-8", out, "-"], capture_output=True, text=True, encoding="utf8").stdout
    if "—" in txt:
        problems.append("hay «—» en el PDF")
    n, warn = fill_report(out, work)
    print(f"OK {out}: {n} páginas. Contacto: {work}/contacto.png · páginas sueltas: {work}/prev/")
    for w in warn + problems:
        print("AVISO:", w)
    return 1 if problems else 0

if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
