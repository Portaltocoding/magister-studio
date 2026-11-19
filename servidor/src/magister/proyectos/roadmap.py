"""El roadmap de construcción: lo escribe el modelo con un método fijo y el código lo monta.

Niveles de capacidad (cada uno, un producto que funciona) → bloques (algo que se puede probar) → pasos (qué haces,
lo mínimo que tienes que saber antes y cómo sabes que está hecho). Encima de todo y de cada nivel y bloque, un
priming de 5 líneas. Solo el nivel 1 (el MVP) sale con pasos: los demás se detallan al llegar, con lo hecho y lo
decidido en el diario delante.
"""

import json
import re
import unicodedata
from collections.abc import Callable

from pydantic import BaseModel, Field

from magister.cerebro.estructura import estructurar
from magister.cerebro.prompts import cargar


class Termino(BaseModel):
    termino: str
    definicion: str


class PasoGen(BaseModel):
    titulo: str
    que_haces: str
    antes: str
    hecho_si: str
    minutos: int = Field(ge=5, le=600)


class BloqueGen(BaseModel):
    titulo: str
    priming: str
    pasos: list[PasoGen] = Field(default_factory=list, max_length=8)


class NivelGen(BaseModel):
    titulo: str
    objetivo: str = Field(description="Qué hace el producto al acabar este nivel, en una frase")
    priming: str
    bloques: list[BloqueGen] = Field(min_length=1, max_length=5)


class Riesgo(BaseModel):
    riesgo: str
    mitigacion: str


class RoadmapGen(BaseModel):
    resumen: str = Field(description="El priming del proyecto entero: como mucho 5 líneas")
    que_es: str
    por_que: str = Field(description="Por qué merece la pena y qué demuestra, para su objetivo")
    glosario: list[Termino] = Field(min_length=3, max_length=20)
    arquitectura: str
    niveles: list[NivelGen] = Field(min_length=2, max_length=5)
    riesgos: list[Riesgo] = Field(min_length=2, max_length=10)
    fuera_de_alcance: list[str] = Field(default_factory=list, max_length=10)


class NivelDetallado(BaseModel):
    bloques: list[BloqueGen] = Field(min_length=1, max_length=5)


# Un «Hecho si» que no se puede comprobar («funciona», «lo entiendes») no le dice al alumno cuándo parar.
_HECHO_VAGO = re.compile(r"^\s*(ya\s+)?(funciona|est[aá] (hecho|listo|terminado)|lo (entiendes|tienes claro|sabes)|todo (va )?bien)\b", re.IGNORECASE)


def _normal(t: str) -> str:
    t = unicodedata.normalize("NFD", t.lower())
    return " " + re.sub(r"[^a-z0-9ñ]+", " ", "".join(c for c in t if unicodedata.category(c) != "Mn")) + " "


def errores_paso(p: PasoGen) -> list[str]:
    """Un paso completo y comprobable (lo usan el roadmap, el detalle de un nivel y los cambios del asesor)."""
    errores = []
    if len(p.hecho_si.strip()) < 20 or _HECHO_VAGO.search(p.hecho_si):
        errores.append(f"El paso «{p.titulo}» necesita un «hecho_si» comprobable (un comando que responde, una prueba que pasa, algo que se ve), no «{p.hecho_si.strip()[:40]}».")
    if len(p.antes.strip()) < 20:
        errores.append(f"El paso «{p.titulo}» necesita su «antes»: lo mínimo que hay que saber, en 2 a 4 frases.")
    if len(p.que_haces.strip()) < 20:
        errores.append(f"El paso «{p.titulo}» necesita un «que_haces» concreto.")
    if not 10 <= p.minutos <= 240:
        errores.append(f"El paso «{p.titulo}» dura {p.minutos} min: pártelo o júntalo para que dure de 10 min a 4 h.")
    return errores


def _con_pasos(bloques: list[BloqueGen], donde: str) -> list[str]:
    """El esqueleto de un nivel detallado: bloques de 2 a 6 pasos, y cada paso completo y comprobable."""
    errores = []
    for b in bloques:
        if not 2 <= len(b.pasos) <= 6:
            errores.append(f"El bloque «{b.titulo}» en {donde} necesita de 2 a 6 pasos (tiene {len(b.pasos)}).")
        for p in b.pasos:
            errores += errores_paso(p)
    titulos = [p.titulo.strip().lower() for b in bloques for p in b.pasos]
    repetidos = sorted({t for t in titulos if titulos.count(t) > 1})
    if repetidos:
        errores.append(f"Hay pasos con el mismo título en {donde}: {', '.join(repetidos)}.")
    return errores


_VACIAS = {"y", "de", "del", "la", "el", "los", "las", "en", "con", "por", "para", "un", "una", "o"}


def _raices(t: str) -> set[str]:
    """Las palabras importantes, sin plural: «volúmenes EBS» y «Volumen EBS» dan lo mismo."""
    salida = set()
    for w in _normal(t).split():
        if w in _VACIAS:
            continue
        for fin in ("es", "s"):
            if len(w) > 4 and w.endswith(fin):
                w = w[: -len(fin)]
                break
        salida.add(w)
    return salida


def _texto_roadmap(r: RoadmapGen) -> str:
    partes = [r.resumen, r.que_es, r.por_que, r.arquitectura, *r.fuera_de_alcance]
    partes += [f"{x.riesgo} {x.mitigacion}" for x in r.riesgos]
    for n in r.niveles:
        partes += [n.titulo, n.objetivo, n.priming]
        for b in n.bloques:
            partes += [b.titulo, b.priming] + [f"{p.titulo} {p.que_haces} {p.antes} {p.hecho_si}" for p in b.pasos]
    return " ".join(partes)


def _sueltos(r: RoadmapGen) -> list[str]:
    """Los términos del glosario que no salen en ningún sitio del roadmap (relleno)."""
    todo = _raices(_texto_roadmap(r))
    return [t.termino for t in r.glosario if not _raices(re.sub(r"\(.*?\)", "", t.termino)) <= todo]


def _glosario(r: RoadmapGen) -> list[Termino]:
    """El glosario sin los términos sueltos, si quedan al menos 3 (si no, tal cual: la regla ya lo ha dicho)."""
    sueltos = set(_sueltos(r))
    limpio = [t for t in r.glosario if t.termino not in sueltos]
    return limpio if len(limpio) >= 3 else list(r.glosario)


def reglas_roadmap(r: RoadmapGen) -> list[str]:
    """Lo que el esquema no puede exigir, en código y sin juez: un esqueleto fiable cada vez."""
    errores = _con_pasos(r.niveles[0].bloques, "el nivel 1")
    for texto, donde in [(r.resumen, "el resumen")] + [(n.priming, f"el nivel «{n.titulo}»") for n in r.niveles]:
        if len([x for x in texto.splitlines() if x.strip()]) > 6 or len(texto) > 900:
            errores.append(f"El priming de {donde} pasa de 5 líneas.")
    for n in r.niveles[1:]:
        for b in n.bloques:
            if len(b.priming.strip()) < 20:
                errores.append(f"El bloque «{b.titulo}» del nivel «{n.titulo}» necesita su priming aunque aún no tenga pasos.")
    objetivos = [n.objetivo.strip().lower() for n in r.niveles]
    if len(set(objetivos)) < len(objetivos):
        errores.append("Dos niveles tienen el mismo objetivo: cada nivel debe hacer algo más que el anterior.")
    # El glosario es de lo que sale en el roadmap: los términos sueltos (relleno) se quitan al montar, y solo es un
    # error si sin ellos se queda corto (no merece rehacer el roadmap entero por un término suelto).
    sueltos = _sueltos(r)
    if sueltos and len(r.glosario) - len(sueltos) < 3:
        errores.append(f"Estos términos del glosario no salen en el roadmap (quítalos o úsalos donde toque): {', '.join(sueltos)}.")
    terminos = [t.termino.strip().lower() for t in r.glosario]
    if len(set(terminos)) < len(terminos):
        errores.append("Hay términos repetidos en el glosario.")
    for x in r.riesgos:
        if len(x.mitigacion.strip()) < 15:
            errores.append(f"El riesgo «{x.riesgo}» necesita una mitigación concreta.")
    return errores


def montar(r: RoadmapGen) -> dict:
    """El roadmap como lo guarda Magister: con ids estables (n1, n1-b2, n1-b2-p3) y el MVP marcado."""
    niveles = []
    for i, n in enumerate(r.niveles, 1):
        # «Nivel 1: solo lee» -> «solo lee» con mayúscula: la pantalla ya pone «Nivel 1» encima.
        titulo = re.sub(r"^\s*nivel\s*\d+\s*[:·.\-–]\s*", "", n.titulo, flags=re.IGNORECASE).strip() or n.titulo
        titulo = titulo[:1].upper() + titulo[1:]
        niveles.append({
            "id": f"n{i}", "numero": i, "titulo": titulo, "objetivo": n.objetivo, "priming": n.priming, "mvp": i == 1,
            "detallado": i == 1 or any(b.pasos for b in n.bloques),
            "bloques": _bloques(f"n{i}", n.bloques),
        })
    return {
        "resumen": r.resumen, "que_es": r.que_es, "por_que": r.por_que,
        "glosario": [t.model_dump() for t in _glosario(r)], "arquitectura": r.arquitectura,
        "niveles": niveles, "riesgos": [x.model_dump() for x in r.riesgos], "fuera_de_alcance": r.fuera_de_alcance,
    }


def _bloques(prefijo: str, bloques: list[BloqueGen], ocupados: frozenset[str] = frozenset()) -> list[dict]:
    """Ids n1-b2 y n1-b2-p3 por posición, saltando los `ocupados` (un bloque que el asesor movió aquí desde otro
    nivel conserva su id, y un id nunca se repite)."""
    salida = []
    j = 0
    for b in bloques:
        j += 1
        while f"{prefijo}-b{j}" in ocupados:
            j += 1
        bid = f"{prefijo}-b{j}"
        salida.append({
            "id": bid, "titulo": b.titulo, "priming": b.priming,
            "pasos": [{"id": f"{bid}-p{k}", **p.model_dump()} for k, p in enumerate(b.pasos, 1)],
        })
    return salida


def ids_de(niveles: list[dict]) -> set[str]:
    """Todos los ids de bloques y pasos de esos niveles."""
    return {x for n in niveles for b in n["bloques"] for x in [b["id"], *(p["id"] for p in b["pasos"])]}


def con_nivel_detallado(roadmap: dict, numero: int, detalle: NivelDetallado) -> dict:
    """El roadmap con los bloques nuevos de ese nivel (los demás niveles, tal cual)."""
    niveles = []
    otros = frozenset(ids_de([n for n in roadmap["niveles"] if n["numero"] != numero]))
    for n in roadmap["niveles"]:
        if n["numero"] == numero:
            n = {**n, "detallado": True, "bloques": _bloques(n["id"], detalle.bloques, otros)}
        niveles.append(n)
    return {**roadmap, "niveles": niveles}


def bloques_vacios(nivel: dict) -> list[dict]:
    """Los bloques del nivel que aún no tienen pasos."""
    return [b for b in nivel["bloques"] if not b["pasos"]]


def por_detallar(nivel: dict) -> bool:
    """Se puede detallar: el nivel aún no lo está, o le quedan bloques sin pasos (un roadmap rehecho que conservó los
    pasos de unos bloques y trajo otros nuevos)."""
    return not nivel.get("detallado") or bool(bloques_vacios(nivel))


def con_bloques_rellenos(roadmap: dict, numero: int, detalle: NivelDetallado, ocupados: frozenset[str] = frozenset()) -> dict:
    """El roadmap con los pasos de `detalle` puestos, en orden, en los bloques vacíos de ese nivel. Los bloques que ya
    tenían pasos no se tocan (ni sus ids ni sus pasos), y los pasos nuevos llevan ids que no están en uso en el roadmap,
    ni en lo apuntado, ni en `ocupados` (lo hecho y el diario)."""
    usados = {*ids_de(roadmap["niveles"]), *(x["id"] for x in roadmap.get("ya_no_estan", [])), *ocupados}
    niveles = []
    for n in roadmap["niveles"]:
        if n["numero"] == numero:
            nuevos = iter(detalle.bloques)
            bloques = []
            for b in n["bloques"]:
                if not b["pasos"]:
                    ps, k = [], 0
                    for p in next(nuevos).pasos:
                        k += 1
                        while f"{b['id']}-p{k}" in usados:
                            k += 1
                        ps.append({"id": f"{b['id']}-p{k}", **p.model_dump()})
                    b = {**b, "pasos": ps}
                bloques.append(b)
            n = {**n, "detallado": True, "bloques": bloques}
        niveles.append(n)
    return {**roadmap, "niveles": niveles}


def pasos(roadmap: dict) -> list[dict]:
    return [p for n in roadmap.get("niveles", []) for b in n["bloques"] for p in b["pasos"]]


# --- Rehacer sin perder lo hecho ----------------------------------------------------------------------------------
# Un roadmap rehecho sale con ids por posición. Para que lo hecho y el diario (que van por id) sigan valiendo, cada
# paso, bloque o nivel nuevo que sea el mismo que uno de antes hereda su id. Ante la duda, no se empareja: es mejor
# un paso hecho que se apunta aparte que uno que aparece hecho sin estarlo.
PARECIDO_MINIMO = 0.6  # la media del parecido del título y del texto
PARECIDO_TITULO = 0.5  # y el título, por sí solo, al menos esto
MARGEN_DUDA = 0.1  # si el segundo candidato se queda a menos de esto del primero, no se sabe cuál es: no se empareja


def _parecido(a: set[str], b: set[str]) -> float:
    return len(a & b) / len(a | b) if a and b else 0.0


def _emparejar_lista(viejos: list[tuple[str, str, str]], nuevos: list[tuple[str, str, str]]) -> dict[str, str]:
    """(id, título, texto) de cada lado -> {id_viejo: id_nuevo}, uno a uno. Primero, el mismo título normalizado (si
    solo hay uno así en cada lado); luego, el parecido de palabras, solo si es alto, sin otro candidato cerca y lo
    mejor para los dos lados."""
    def por_titulo(lista):
        grupos: dict[str, list[str]] = {}
        for i, t, _ in lista:
            grupos.setdefault(_normal(t).strip(), []).append(i)
        return grupos

    pares: dict[str, str] = {}
    titulos_n = por_titulo(nuevos)
    for clave, ids in por_titulo(viejos).items():
        if clave and len(ids) == 1 and len(titulos_n.get(clave, [])) == 1:
            pares[ids[0]] = titulos_n[clave][0]
    libres_v = [x for x in viejos if x[0] not in pares]
    tomados = set(pares.values())
    libres_n = [x for x in nuevos if x[0] not in tomados]
    raices_n = {i: (_raices(t), _raices(q)) for i, t, q in libres_n}
    notas: dict[tuple[str, str], float] = {}
    for iv, tv, qv in libres_v:
        rt, rq = _raices(tv), _raices(qv)
        for i_n, (nt, nq) in raices_n.items():
            t = _parecido(rt, nt)
            notas[(iv, i_n)] = (t + _parecido(rq, nq)) / 2 if t >= PARECIDO_TITULO else 0.0

    def claro(candidatos: list[tuple[float, str]]) -> str | None:
        candidatos = sorted(candidatos, reverse=True)
        if not candidatos or candidatos[0][0] < PARECIDO_MINIMO:
            return None
        if len(candidatos) > 1 and candidatos[0][0] - candidatos[1][0] < MARGEN_DUDA:
            return None
        return candidatos[0][1]

    for iv, _, _ in libres_v:
        i_n = claro([(notas[(iv, x)], x) for x in raices_n])
        if i_n is not None and claro([(notas[(y[0], i_n)], y[0]) for y in libres_v]) == iv:
            pares[iv] = i_n
    return pares


def emparejar(roadmap_viejo: dict, roadmap_nuevo: dict) -> dict[str, str]:
    """{id_viejo: id_nuevo} de los niveles, bloques y pasos que siguen siendo los mismos (cada clase con la suya), en
    código y sin modelo: por título normalizado y, si no, por parecido de palabras del título y de su texto."""
    def lados(r: dict) -> tuple[list, list, list]:
        niveles = [(n["id"], n["titulo"], n.get("objetivo") or "") for n in r.get("niveles", [])]
        bloques = [(b["id"], b["titulo"], b.get("priming") or "") for n in r.get("niveles", []) for b in n["bloques"]]
        return niveles, bloques, [(p["id"], p["titulo"], p.get("que_haces") or "") for p in pasos(r)]

    pares: dict[str, str] = {}
    for viejos, nuevos in zip(lados(roadmap_viejo), lados(roadmap_nuevo)):
        pares |= _emparejar_lista(viejos, nuevos)
    return pares


def apuntar_perdidos(antes: dict, despues: dict, hechos: list[str], hechos_en: dict) -> dict:
    """`despues` con «ya_no_estan» al día: lo hecho de los pasos de `antes` que en `despues` ya no están (con su
    título y cuándo lo marcaste), más lo que ya estaba apuntado y sigue sin estar. Lo hecho no se borra: se apunta."""
    presentes = {p["id"] for p in pasos(despues)}
    titulos = {p["id"]: p["titulo"] for p in pasos(antes)}
    salida: dict[str, dict] = {}
    for x in [*antes.get("ya_no_estan", []), *despues.get("ya_no_estan", [])]:
        salida.setdefault(x["id"], x)
    for x in hechos:
        if x in titulos:
            salida.setdefault(x, {"id": x, "titulo": titulos[x], "hecho_en": hechos_en.get(x)})
    return {**despues, "ya_no_estan": [x for k, x in salida.items() if k not in presentes]}


def conservar(viejo: dict, nuevo: dict, hechos: list[str], hechos_en: dict, usados: set[str] = frozenset()) -> dict:
    """El roadmap `nuevo` (recién montado, con ids por posición) con los ids de `viejo` donde el nivel, el bloque o el
    paso es el mismo (`emparejar`): así lo hecho, sus fechas y el diario siguen valiendo sin tocarlos. Los demás
    reciben ids que no han existido nunca (ni en `viejo`, ni en lo hecho, ni en lo apuntado, ni en `usados`: los
    pasos del diario). Lleva «conservados» (cuántos pasos hechos siguen) y «ya_no_estan»."""
    heredado = {n: v for v, n in emparejar(viejo, nuevo).items()}
    ocupados = {*ids_de(viejo.get("niveles", [])), *(n["id"] for n in viejo.get("niveles", [])), *hechos, *hechos_en,
                *(x["id"] for x in viejo.get("ya_no_estan", [])), *usados, *heredado.values()}

    def nuevo_id(prefijo: str) -> str:
        numeros = [int(m.group(1)) for x in ocupados if (m := re.fullmatch(re.escape(prefijo) + r"(\d+)", x))]
        x = f"{prefijo}{max(numeros + [0]) + 1}"
        ocupados.add(x)
        return x

    # El roadmap nuevo solo trae detallado el nivel 1. Un bloque que sale sin pasos y es el mismo que uno de antes que
    # ya detallaste conserva esos pasos con sus ids (y lo hecho en ellos), salvo los que ya heredó un paso nuevo.
    pasos_de_antes = {b["id"]: b["pasos"] for n in viejo.get("niveles", []) for b in n["bloques"]}
    heredados = set(heredado.values())

    niveles = []
    for n in nuevo.get("niveles", []):
        nid = heredado.get(n["id"]) or nuevo_id("n")
        bloques = []
        for b in n["bloques"]:
            bid = heredado.get(b["id"]) or nuevo_id(f"{nid}-b")
            if b["pasos"]:
                ps = [{**p, "id": heredado.get(p["id"]) or nuevo_id(f"{bid}-p")} for p in b["pasos"]]
            else:
                ps = [p for p in pasos_de_antes.get(bid, []) if p["id"] not in heredados]
            bloques.append({**b, "id": bid, "pasos": ps})
        # Con pasos conservados el nivel ya está detallado; si además trae bloques nuevos sin pasos, detallarlo
        # rellena solo esos (`por_detallar`, `con_bloques_rellenos`).
        niveles.append({**n, "id": nid, "bloques": bloques, "detallado": bool(n.get("detallado")) or any(b["pasos"] for b in bloques)})
    salida = {**nuevo, "niveles": niveles}
    presentes = {p["id"] for p in pasos(salida)}
    salida["conservados"] = sum(1 for x in dict.fromkeys(hechos) if x in presentes)
    return apuntar_perdidos(viejo, salida, hechos, hechos_en)


def texto_referencias(referencias: list[dict]) -> str:
    """Las referencias de la web, marcadas como externas: son datos, nunca instrucciones."""
    from magister.seguridad.entrada import AVISO, marcar_externo

    if not referencias:
        return "(ninguna)"
    marcadas = [marcar_externo(f"{r['titulo'][:200]} ({r['url'][:500]}): {(r.get('motivo') or '')[:400]}", i, "web")
                for i, r in enumerate(referencias, 1)]
    return AVISO + "\n\n" + "\n".join(marcadas)


async def generar_roadmap(datos: dict, referencias: list[dict]) -> dict:
    sistema = cargar("proyecto_roadmap").rellenar(
        nombre=datos["nombre"], idea=datos["idea"], objetivo=datos.get("objetivo") or "(no lo ha dicho)",
        sabes=datos.get("sabes") or "(no lo ha dicho)", ritmo=datos.get("ritmo") or "(no lo ha dicho)",
        referencias=texto_referencias(referencias))
    r = await estructurar(sistema, "Devuelve el roadmap de construcción.", RoadmapGen, reglas=reglas_roadmap)
    return montar(r)


def texto_niveles_anteriores(roadmap: dict, numero: int, hechos: list[str]) -> str:
    """Los pasos de los niveles ya detallados antes de este, con lo hecho marcado: el nivel nuevo parte de ahí."""
    partes = []
    for n in roadmap["niveles"]:
        if n["numero"] >= numero or not n.get("detallado"):
            continue
        partes.append(f"Nivel {n['numero']}: {n['titulo']}")
        partes += [f"- {'[hecho] ' if p['id'] in hechos else ''}{p['titulo']}: {p['que_haces']}"
                   for b in n["bloques"] for p in b["pasos"]]
    return "\n".join(partes) or "(ninguno)"


def _texto_diario(decisiones: list[dict]) -> str:
    lineas = []
    for d in decisiones[-15:]:  # las más recientes: el diario puede crecer mucho
        contexto = (d.get("contexto") or "").strip()
        lineas.append(f"- {d['titulo']}: {d['decision']}" + (f" (contexto: {contexto})" if contexto else ""))
    return "\n".join(lineas) or "(sin decisiones apuntadas)"


_ENCARGO_TODO = ("Devuelve los bloques del nivel (puedes ajustar sus títulos y su priming si lo hecho o lo decidido lo "
                 "pide, sin cambiar el objetivo del nivel).")


def _encargo(nivel: dict) -> str:
    """Qué bloques hay que devolver: todos, o solo los que aún no tienen pasos (los demás no se tocan)."""
    vacios = bloques_vacios(nivel)
    if len(vacios) == len(nivel["bloques"]):
        return _ENCARGO_TODO
    lista = "; ".join(f"«{b['titulo']}»" for b in vacios)
    return ("Algunos bloques de este nivel ya tienen sus pasos (van en «pasos_que_ya_tiene») y no se tocan. Devuelve "
            f"solo los bloques que aún no tienen pasos ({len(vacios)}), en este orden y con el mismo título: {lista}. "
            "Sus pasos parten de lo que ya hay y no repiten ninguno de los que ya están.")


def sistema_nivel(roadmap: dict, numero: int, hechos: list[str], decisiones: list[dict], datos: dict) -> str:
    """El prompt para detallar un nivel (sin llamar al modelo, para poder probarlo). Si el nivel ya tiene pasos en
    unos bloques, pide solo los de los bloques vacíos y enseña los que ya hay."""
    nivel = next(n for n in roadmap["niveles"] if n["numero"] == numero)
    hecho = [f"- {p['titulo']}" for p in pasos(roadmap) if p["id"] in hechos] or ["(todavía nada)"]
    bloques = [{"titulo": b["titulo"], "priming": b["priming"]}
               | ({"pasos_que_ya_tiene": [p["titulo"] for p in b["pasos"]]} if b["pasos"] else {})
               for b in nivel["bloques"]]
    resumen_proyecto = {
        "nombre": datos["nombre"], "idea": datos["idea"], "lo_que_sabe": datos.get("sabes"), "ritmo": datos.get("ritmo"),
        "resumen": roadmap["resumen"], "arquitectura": roadmap["arquitectura"],
        "niveles": [{"numero": n["numero"], "titulo": n["titulo"], "objetivo": n["objetivo"]} for n in roadmap["niveles"]],
    }
    return cargar("proyecto_nivel").rellenar(
        encargo=_encargo(nivel),
        proyecto=json.dumps(resumen_proyecto, ensure_ascii=False, indent=1),
        niveles_anteriores=texto_niveles_anteriores(roadmap, numero, hechos),
        hecho="\n".join(hecho),
        diario=_texto_diario(decisiones),
        nivel=json.dumps({k: nivel[k] for k in ("numero", "titulo", "objetivo", "priming")} | {"bloques": bloques},
                         ensure_ascii=False, indent=1))


def reglas_relleno(nivel: dict, numero: int) -> Callable[[NivelDetallado], list[str]]:
    """Las reglas del detalle de solo los bloques vacíos: uno por bloque vacío, y sin repetir los pasos que ya hay."""
    vacios = bloques_vacios(nivel)
    ya = {p["titulo"].strip().lower() for b in nivel["bloques"] for p in b["pasos"]}

    def reglas(x: NivelDetallado) -> list[str]:
        errores = _con_pasos(x.bloques, f"el nivel {numero}")
        if len(x.bloques) != len(vacios):
            errores.append(f"Devuelve exactamente {len(vacios)} bloques, los que aún no tienen pasos y en su orden "
                           f"(has devuelto {len(x.bloques)}).")
        repetidos = sorted({p.titulo for b in x.bloques for p in b.pasos if p.titulo.strip().lower() in ya})
        if repetidos:
            errores.append(f"Estos pasos ya están en otro bloque del nivel: {', '.join(repetidos)}.")
        return errores

    return reglas


async def detallar_nivel(roadmap: dict, numero: int, hechos: list[str], decisiones: list[dict], datos: dict,
                         usados: frozenset[str] = frozenset()) -> dict:
    """Pone los pasos al nivel. Si ya tiene pasos en unos bloques, rellena solo los vacíos (los demás, con sus ids, lo
    hecho y el diario, no se tocan); si no le queda ninguno vacío, no llama al modelo (un reintento no rehace nada)."""
    nivel = next(n for n in roadmap["niveles"] if n["numero"] == numero)
    vacios = bloques_vacios(nivel)
    if nivel["bloques"] and not vacios:
        return {**roadmap, "niveles": [{**n, "detallado": True} if n["numero"] == numero else n for n in roadmap["niveles"]]}
    sistema = sistema_nivel(roadmap, numero, hechos, decisiones, datos)
    if len(vacios) == len(nivel["bloques"]):
        d = await estructurar(sistema, "Devuelve los bloques del nivel con sus pasos.", NivelDetallado,
                              reglas=lambda x: _con_pasos(x.bloques, f"el nivel {numero}"))
        return con_nivel_detallado(roadmap, numero, d)
    d = await estructurar(sistema, "Devuelve solo los bloques sin pasos, con sus pasos.", NivelDetallado,
                          reglas=reglas_relleno(nivel, numero))
    return con_bloques_rellenos(roadmap, numero, d, frozenset({*hechos, *usados}))


def extraer_svg(texto: str) -> str | None:
    m = re.search(r"<svg\b[\s\S]*?</svg>", texto)
    return m.group(0) if m else None


async def dibujar_arquitectura(datos: dict, roadmap: dict) -> str | None:
    from magister.cerebro.modelo import Turno, generar

    sistema = cargar("proyecto_arquitectura").rellenar(nombre=datos["nombre"], idea=datos["idea"][:1500],
                                                       arquitectura=roadmap["arquitectura"])
    respuesta = "".join([t async for t in generar(sistema, [Turno("usuario", "Dibuja la arquitectura.")])])
    return extraer_svg(respuesta)
