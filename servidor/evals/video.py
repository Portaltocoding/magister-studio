"""Comprobaciones por código de un guion gráfico (el vídeo animado), sin modelo: lo que `material.guion_grafico.reglas`
no mira o que solo se ve en la pantalla de `web/src/escena`.

    uv run python -m evals.video                                  todos los guion_grafico-*.json de MAGISTER_SALIDAS
    uv run python -m evals.video ruta/guion_grafico-12.json --minutos 6 --medidas medidas.json

Tres familias de hallazgos (error: se ve mal o se rompe; aviso: probablemente se ve mal):

- Duración y voz. La web estima cada tramo a 150 palabras por minuto (mínimo 5 s) o, con la voz de Magister, lo
  mide trozo a trozo (`tipos.ts`, `lineaDeTiempo`). Aquí: narración vacía o demasiado larga, duración total lejos de
  los minutos pedidos y, con medidas, un trozo sin audio, medidas que no casan con los trozos (la web cae en silencio
  a la estimación) o una voz que va demasiado deprisa o despacio para su texto (no es la de ese texto o se cortó).
- Texto desbordado o vacío. Cada escena tiene un hueco fijo en 1280 × 720: un título que se corta con puntos
  suspensivos, líneas de código o de consulta que no caben (la consulta no parte líneas), tablas de más de 7 filas,
  escenas sin nada que pintar. Los anchos salen de los estilos de `web/src/escena` y son aproximados (ver LIMITES).
- Referencias. Lo que una escena nombra tiene que existir: la idea actual del tablero, los puntos de una figura, las
  líneas resaltadas, las filas de un escaneo o de un índice, el camino de un árbol, y un tipo de escena que la web pinte.

Las funciones de los trozos (`frases`, `respiros`, `trozos`) son las de `tipos.ts`, traducidas tal cual: si cambia
una, cambia la otra.
"""

import argparse
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path

from magister.material.guion_grafico import HOLGURA, MAX_PALABRAS_TRAMO, PALABRAS_MINUTO

FPS = 30
MINIMO_S = 5.0
RESPIRO_S = 1.2  # lo que añade la estimación a cada tramo
SOLAPE_S = 8 / FPS
ESCENAS_WEB = {"tablero", "por_dentro", "pregunta", "contraste", "opciones", "tabla", "indice", "mitades", "arbol",
               "barras", "consulta", "pasos", "figura", "formula", "calculo"}

# Caracteres que caben, sacados de los estilos de web/src/escena (ancho del hueco entre ancho medio de un carácter).
# Son aproximados: un aviso dice «probablemente no cabe», no «no cabe».
LIMITES = {
    "titulo": 60,          # piezas.tsx: maxWidth 1128, serif 36, con elipsis
    "codigo": 40,          # escenas.tsx: zona de 380 px, monoespaciada
    "consulta": 70,        # escenas_datos.tsx: whiteSpace pre (no parte), mono 17
    "pregunta": 150,       # serif 40 en 980 px: tres líneas
    "pasos": 90,
    "celda": 28,
    "opcion_explica": 170,  # tarjeta de alto fijo (360 px)
    "palabras_idea": 3,
    "palabras_que": 6,
    "ideas": 8,
    "lineas_contraste": 8,
}
VOZ_PALABRAS_SEGUNDO = (1.6, 4.0)  # 150 ppm son 2,5 palabras por segundo


@dataclass(frozen=True)
class Hallazgo:
    tramo: int | None
    regla: str
    detalle: str
    gravedad: str = "error"  # error o aviso

    def __str__(self) -> str:
        donde = f"tramo {self.tramo}" if self.tramo is not None else "guion"
        return f"[{self.gravedad}] {donde} · {self.regla}: {self.detalle}"


# --- Los trozos de la voz, como en tipos.ts ---------------------------------------------------------------------------

_FRASE = re.compile(r"(?<=[.!?…])\s+(?=[A-ZÁÉÍÓÚÑ¿¡0-9«])")
_RESPIRO = re.compile(r"(?<=[,;:])\s+")


def frases(narracion: str) -> list[str]:
    return [x for x in _FRASE.split(narracion) if x]


def respiros(frase: str) -> list[str]:
    return [x for x in _RESPIRO.split(frase) if x]


def trozos(narracion: str) -> list[str]:
    return [t for f in frases(narracion) for t in respiros(f)]


def palabras(texto: str) -> int:
    return len(texto.split())


def segundos_estimados(narracion: str, ritmo: float = 1.0) -> float:
    """Como `duracionTramo`: a 150 palabras por minuto, con su respiro y nunca menos de 5 s."""
    return max(MINIMO_S, palabras(narracion) / (PALABRAS_MINUTO * ritmo) * 60 + RESPIRO_S)


def duracion_total(guion: dict) -> float:
    """Segundos del vídeo estimado: los tramos se cruzan SOLAPE fotogramas."""
    tramos = guion.get("tramos") or []
    if not tramos:
        return 0.0
    return sum(segundos_estimados(t.get("narracion", "")) for t in tramos) - SOLAPE_S * (len(tramos) - 1)


# --- Comprobaciones -------------------------------------------------------------------------------------------------


def _llaves_equilibradas(tex: str) -> bool:
    nivel = 0
    for i, c in enumerate(tex):
        if c == "{" and (i == 0 or tex[i - 1] != "\\"):
            nivel += 1
        elif c == "}" and (i == 0 or tex[i - 1] != "\\"):
            nivel -= 1
            if nivel < 0:
                return False
    return nivel == 0


def _vacio(x) -> bool:
    return x is None or (isinstance(x, str) and not x.strip()) or (isinstance(x, (list, dict)) and not x)


def comprobar_voz(guion: dict, minutos: float | None = None, medidas: list[list[float | None]] | None = None) -> list[Hallazgo]:
    h: list[Hallazgo] = []
    tramos = guion.get("tramos") or []
    for i, t in enumerate(tramos):
        narracion = (t.get("narracion") or "").strip()
        n = palabras(narracion)
        if n == 0:
            h.append(Hallazgo(i, "narracion_vacia", "el tramo no dice nada: 5 s de imagen muda y sin subtítulo"))
            continue
        if n > MAX_PALABRAS_TRAMO:
            h.append(Hallazgo(i, "narracion_larga", f"{n} palabras (más de {MAX_PALABRAS_TRAMO}): la escena se queda quieta "
                                                    f"{segundos_estimados(narracion):.0f} s"))
        elif n < 10:
            h.append(Hallazgo(i, "narracion_corta", f"{n} palabras: el tramo dura el mínimo y la voz acaba antes que la escena",
                              "aviso"))
        if any(c in narracion for c in "$\\^"):
            h.append(Hallazgo(i, "formula_en_voz", "la narración se lee en voz alta: las fórmulas, con palabras"))
    if minutos and tramos:
        total = duracion_total(guion)
        objetivo = minutos * 60
        if not (1 - HOLGURA) * objetivo <= total <= (1 + HOLGURA) * objetivo:
            h.append(Hallazgo(None, "duracion_total", f"unos {total / 60:.1f} min estimados para {minutos:g} pedidos", "aviso"))
    if medidas is not None:
        if len(medidas) != len(tramos):
            h.append(Hallazgo(None, "medidas_de_mas" if len(medidas) > len(tramos) else "medidas_de_menos",
                              f"{len(medidas)} tramos medidos para {len(tramos)} tramos"))
        for i, (t, m) in enumerate(zip(tramos, medidas, strict=False)):
            lista = trozos(t.get("narracion") or "")
            if len(m) != len(lista):
                h.append(Hallazgo(i, "medidas_desalineadas", f"{len(m)} medidas para {len(lista)} trozos: la web usa la "
                                                             "estimación sin avisar"))
                continue
            sin = [k for k, (z, s) in enumerate(zip(lista, m, strict=True)) if re.search(r"\w", z) and not s]
            if sin:
                h.append(Hallazgo(i, "trozo_sin_audio", f"trozos {sin} con texto y sin audio: se ven sin oírse"))
            segundos = sum(s for s in m if s)
            if segundos > 0:
                ritmo = palabras(t.get("narracion") or "") / segundos
                lo, hi = VOZ_PALABRAS_SEGUNDO
                if not lo <= ritmo <= hi:
                    h.append(Hallazgo(i, "ritmo_voz", f"{ritmo:.1f} palabras por segundo (lo normal, de {lo} a {hi}): "
                                                      "el audio no parece de este texto o se ha cortado", "aviso"))
    return h


def _ideas(escena: dict) -> list[dict]:
    return [idea for p in escena.get("partes") or [] for idea in p.get("ideas") or []]


def comprobar_escena(i: int, t: dict, partes: list[dict] | None = None) -> list[Hallazgo]:
    """`partes`: el mapa del guion, para los tableros que no lo traen dentro (la web lo pone en cada uno al montar)."""
    h: list[Hallazgo] = []
    e = t.get("escena") or {}
    tipo = e.get("tipo")

    def error(regla, detalle):
        h.append(Hallazgo(i, regla, detalle))

    def aviso(regla, detalle):
        h.append(Hallazgo(i, regla, detalle, "aviso"))

    titulo = f"{t.get('concepto', '')} · {t.get('tesis', '')}"
    if _vacio(t.get("concepto")):
        error("sin_titulo", "el tramo no tiene concepto (el título de la escena)")
    elif len(titulo) > LIMITES["titulo"]:
        aviso("titulo_largo", f"«{titulo[:70]}» tiene {len(titulo)} caracteres: se corta con puntos suspensivos")
    if tipo not in ESCENAS_WEB:
        error("escena_desconocida", f"la web no sabe pintar «{tipo}»")
        return h

    if tipo == "tablero":
        ideas = _ideas(e) if e.get("partes") else _ideas({"partes": partes or []})
        if not ideas:
            error("tablero_vacio", "el mapa no tiene ideas")
        elif not isinstance(e.get("actual"), int) or not 0 <= e["actual"] < len(ideas):
            error("idea_inexistente", f"actual {e.get('actual')} y el mapa tiene {len(ideas)} ideas (de 0 a {len(ideas) - 1})")
        if len(ideas) > LIMITES["ideas"]:
            aviso("mapa_apretado", f"{len(ideas)} ideas en una fila: las tarjetas quedan estrechas")
        for idea in ideas:
            if palabras(idea.get("nombre", "")) > LIMITES["palabras_idea"]:
                aviso("idea_larga", f"«{idea.get('nombre')}»: más de {LIMITES['palabras_idea']} palabras en la tarjeta")
            if palabras(idea.get("que", "")) > LIMITES["palabras_que"]:
                aviso("idea_larga", f"«{idea.get('que')}»: más de {LIMITES['palabras_que']} palabras bajo la idea")
    elif tipo == "por_dentro":
        codigo = (e.get("codigo") or {}).get("lineas") or []
        if not codigo:
            error("codigo_vacio", "«por dentro» sin código")
        largas = [k + 1 for k, linea in enumerate(codigo) if len(linea) > LIMITES["codigo"]]
        if largas:
            aviso("codigo_ancho", f"líneas {largas} de más de {LIMITES['codigo']} caracteres en una zona de 380 px")
        fuera = [n for n in (e.get("codigo") or {}).get("resaltar") or [] if not 1 <= n <= len(codigo)]
        if fuera:
            error("linea_inexistente", f"resalta las líneas {fuera} y el código tiene {len(codigo)}")
        if _vacio((e.get("memoria") or {}).get("filas")):
            aviso("memoria_vacia", "la memoria no tiene filas")
        if _vacio(e.get("flujo")):
            aviso("sin_flujo", "no hay cables: el dato no viaja")
    elif tipo == "pregunta":
        if _vacio(e.get("pregunta")):
            error("pregunta_vacia", "la escena de pregunta no pregunta nada")
        elif len(e["pregunta"]) > LIMITES["pregunta"]:
            aviso("pregunta_larga", f"{len(e['pregunta'])} caracteres a tamaño 40: más de tres líneas")
    elif tipo == "contraste":
        lados = e.get("lados") or []
        if not 2 <= len(lados) <= 3:
            error("lados", f"{len(lados)} lados (de 2 a 3)")
        if lados:
            cabe = int(((1128 - 24 * (len(lados) - 1)) / len(lados) - 44) / 11.4)
            for lado in lados:
                lineas = lado.get("lineas") or []
                if not lineas:
                    error("lado_vacio", f"el lado «{lado.get('etiqueta')}» no tiene líneas")
                if len(lineas) > LIMITES["lineas_contraste"]:
                    aviso("lado_largo", f"«{lado.get('etiqueta')}»: {len(lineas)} líneas no caben en la tarjeta")
                anchas = [x for x in lineas if len(x) > cabe]
                if anchas:
                    aviso("linea_ancha", f"«{anchas[0][:50]}» pasa de unos {cabe} caracteres con {len(lados)} lados")
    elif tipo == "opciones":
        opciones = e.get("opciones") or []
        if not 2 <= len(opciones) <= 4:
            error("opciones", f"{len(opciones)} opciones (de 2 a 4)")
        for o in opciones:
            if _vacio(o.get("nombre")) or _vacio(o.get("explica")):
                error("opcion_vacia", "una opción sin nombre o sin explicación")
            elif len(o["explica"]) > LIMITES["opcion_explica"]:
                aviso("opcion_larga", f"«{o['nombre']}»: {len(o['explica'])} caracteres en una tarjeta de alto fijo")
    elif tipo == "tabla":
        columnas, filas = e.get("columnas") or [], e.get("filas") or []
        if not columnas or not filas:
            error("tabla_vacia", "tabla sin columnas o sin filas")
        if len(filas) > 7:
            aviso("tabla_larga", f"{len(filas)} filas (caben 7; lo demás va en «resto»)")
        for k, f in enumerate(filas):
            if len(f) != len(columnas):
                error("celdas", f"la fila {k} tiene {len(f)} celdas para {len(columnas)} columnas")
        anchas = [c for f in filas for c in f if len(str(c)) > LIMITES["celda"]]
        if anchas:
            aviso("celda_ancha", f"«{str(anchas[0])[:40]}» pasa de {LIMITES['celda']} caracteres")
        esc = e.get("escaneo") or {}
        fuera = [n for n in esc.get("coincide") or [] if not 0 <= n < len(filas)]
        if fuera:
            error("fila_inexistente", f"el escaneo marca las filas {fuera} y hay {len(filas)}")
    elif tipo == "indice":
        entradas = e.get("entradas") or []
        ids = {f.get("id") for f in (e.get("tabla") or {}).get("filas") or [] if f.get("id") is not None}
        if not entradas:
            error("indice_vacio", "índice sin entradas")
        perdidas = sorted({x["fila"] for x in entradas if x.get("fila") is not None and x["fila"] not in ids})
        if perdidas:
            error("fila_inexistente", f"entradas que apuntan a filas {perdidas} que no están en la tabla")
        fuera = [n for n in e.get("marcar") or [] if not 0 <= n < len(entradas)]
        if fuera:
            error("entrada_inexistente", f"marca las entradas {fuera} y hay {len(entradas)}")
    elif tipo == "mitades":
        if not isinstance(e.get("total"), (int, float)) or e["total"] <= 0:
            error("mitades", "«total» tiene que ser un número mayor que 0")
    elif tipo == "arbol":
        niveles, camino = e.get("niveles") or [], e.get("camino") or []
        if not niveles:
            error("arbol_vacio", "árbol sin niveles")
        if len(camino) != len(niveles):
            error("camino", f"el camino tiene {len(camino)} pasos y el árbol {len(niveles)} niveles")
        for k, (nivel, j) in enumerate(zip(niveles, camino, strict=False)):
            if not 0 <= j < len(nivel):
                error("nodo_inexistente", f"el camino baja al nodo {j} del nivel {k}, que tiene {len(nivel)}")
    elif tipo == "barras":
        barras = e.get("barras") or []
        if not 2 <= len(barras) <= 6:
            error("barras", f"{len(barras)} barras (de 2 a 6)")
        if e.get("escala") == "log" and any(not isinstance(b.get("valor"), (int, float)) or b["valor"] <= 0 for b in barras):
            error("log_sin_positivos", "en escala logarítmica todos los valores tienen que ser mayores que 0")
    elif tipo == "consulta":
        sql = e.get("sql") or []
        if not sql:
            error("consulta_vacia", "consulta sin órdenes")
        anchas = [k + 1 for k, linea in enumerate(sql) if len(linea) > LIMITES["consulta"]]
        if anchas:
            aviso("consulta_ancha", f"líneas {anchas} de más de {LIMITES['consulta']} caracteres (la consulta no parte líneas)")
        if _vacio(e.get("salida")):
            aviso("sin_salida", "la consulta no enseña lo que devuelve")
    elif tipo == "pasos":
        pasos = e.get("pasos") or []
        if not 2 <= len(pasos) <= 6:
            error("pasos", f"{len(pasos)} pasos (de 2 a 6)")
        for p in pasos:
            if _vacio(p.get("texto")):
                error("paso_vacio", "un paso sin texto")
            elif len(p["texto"]) > LIMITES["pasos"]:
                aviso("paso_largo", f"«{p['texto'][:50]}…» pasa de {LIMITES['pasos']} caracteres")
    elif tipo == "figura":
        elementos = e.get("elementos") or []
        if not elementos:
            error("figura_vacia", "figura sin elementos")
        ids = [x.get("id") for x in elementos if x.get("tipo") == "punto"]
        repetidos = sorted({x for x in ids if ids.count(x) > 1})
        if repetidos:
            error("punto_repetido", f"puntos con el mismo id: {repetidos}")
        refs = {"segmento": ("de", "a"), "proyeccion": ("de", "a"), "angulo": ("vertice",), "norte": ("en",)}
        for x in elementos:
            for campo in refs.get(x.get("tipo"), ()):
                if x.get(campo) not in ids:
                    error("punto_inexistente", f"{x.get('tipo')} con {campo} «{x.get(campo)}», que no es ningún punto")
    elif tipo == "formula":
        formulas = e.get("formulas") or []
        if not formulas or any(_vacio(f.get("tex")) for f in formulas):
            error("formula_vacia", "una fórmula sin LaTeX")
        for f in formulas:
            if f.get("tex") and not _llaves_equilibradas(f["tex"]):
                error("latex_roto", f"llaves sin cerrar en «{f['tex'][:40]}»: KaTeX no la pinta")
    elif tipo == "calculo":
        filas = e.get("filas") or []
        if not filas:
            error("calculo_vacio", "cálculo sin filas")
        for f in filas:
            if _vacio(f.get("resultado")):
                error("sin_resultado", f"«{f.get('que')}» sin resultado")
            for campo in ("sustitucion", "resultado"):
                if f.get(campo) and not _llaves_equilibradas(f[campo]):
                    error("latex_roto", f"llaves sin cerrar en «{f[campo][:40]}»")
    return h


def comprobar(guion: dict, minutos: float | None = None, medidas: list[list[float | None]] | None = None) -> list[Hallazgo]:
    """Todos los hallazgos de un guion gráfico tal como lo pinta la web (`montar`), o tal como lo escribe el modelo (con
    `partes` arriba y tableros sin mapa)."""
    h: list[Hallazgo] = []
    tramos = guion.get("tramos") or []
    if len(tramos) < 3:
        h.append(Hallazgo(None, "pocos_tramos", f"{len(tramos)} tramos (al menos 3)"))
    if tramos and (tramos[0].get("escena") or {}).get("tipo") != "tablero":
        h.append(Hallazgo(0, "sin_mapa", "el primer tramo no es el mapa (tablero)", "aviso"))
    for i, t in enumerate(tramos):
        h += comprobar_escena(i, t, guion.get("partes"))
    return h + comprobar_voz(guion, minutos, medidas)


def errores(hallazgos: list[Hallazgo]) -> list[Hallazgo]:
    return [x for x in hallazgos if x.gravedad == "error"]


def main(argv: list[str] | None = None) -> int:
    from magister.config import ajustes

    ap = argparse.ArgumentParser(description="Comprobaciones por código de los guiones gráficos (sin modelo).")
    ap.add_argument("rutas", nargs="*", type=Path, help="ficheros guion_grafico-*.json (por defecto, los de MAGISTER_SALIDAS)")
    ap.add_argument("--minutos", type=float, help="los minutos pedidos, para comprobar la duración total")
    ap.add_argument("--medidas", type=Path, help="JSON con los segundos de cada trozo de cada tramo (la voz medida)")
    args = ap.parse_args(argv)
    rutas = args.rutas or sorted(Path(ajustes.salidas).rglob("guion_grafico-*.json"))
    if not rutas:
        print(f"No hay guiones gráficos en {ajustes.salidas}.")
        return 0
    medidas = None
    if args.medidas:
        with open(args.medidas, encoding="utf-8") as f:
            medidas = json.load(f)
    con_errores = 0
    for ruta in rutas:
        with open(ruta, encoding="utf-8") as f:
            guion = json.load(f)
        h = comprobar(guion, args.minutos, medidas if len(rutas) == 1 else None)
        con_errores += bool(errores(h))
        print(f"{ruta} · {len(guion.get('tramos') or [])} tramos · unos {duracion_total(guion) / 60:.1f} min · "
              f"{len(errores(h))} errores, {len(h) - len(errores(h))} avisos")
        for x in h:
            print(f"  {x}")
    print(f"\n{con_errores} de {len(rutas)} guiones con errores. Sin llamadas al modelo.")
    return 1 if con_errores else 0


if __name__ == "__main__":
    sys.exit(main())
