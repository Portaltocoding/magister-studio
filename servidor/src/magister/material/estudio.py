"""Técnicas de estudio sobre los apuntes de una lección (ideas del vídeo de John sobre estudiar con IA):

- Calentamiento (priming): el tema en 5 frases y una frase por apartado, calibrado al alumno.
- «Dímelo más fácil»: un apartado en 3 frases sencillas, sin tocar los apuntes.
- Banco del examen oral: preguntas en tres bloques (panorámica, sección a sección, profundización).
- Repaso del tema (volcado): el alumno cuenta todo lo que recuerda; se ordena sin cambiarlo, se corrige por
  apartados (bien, flojo, falta) y se programa el siguiente (2, 5, 7, 14, 21 y 30 días; más juntos si hay examen).

Lo generado se guarda por material y versión: no se paga dos veces la misma llamada.
"""

from datetime import date, datetime, timedelta, timezone
from typing import Literal

from pydantic import BaseModel, Field
from sqlalchemy import select, text

from magister.cerebro.estructura import estructurar
from magister.cerebro.prompts import cargar
from magister.datos.material import BloqueMaterial, Material
from magister.datos.sesion import nueva_sesion

INTERVALOS_TEMA = (2, 5, 7, 14, 21, 30)
ESTILOS_EXAMEN = ("oral", "desarrollo", "test", "cortas", "sin_examen")


async def _leer(clave: str):
    from magister.datos.produccion import Ajuste

    async with nueva_sesion() as s:
        fila = await s.get(Ajuste, clave)
    return fila.valor if fila else None


async def _guardar(clave: str, valor) -> None:
    from sqlalchemy.dialects.postgresql import insert

    from magister.datos.produccion import Ajuste

    async with nueva_sesion() as s, s.begin():
        await s.execute(insert(Ajuste).values(clave=clave, valor=valor)
                        .on_conflict_do_update(index_elements=[Ajuste.clave], set_={"valor": valor}))


async def _material(mid: int) -> tuple[Material, list[BloqueMaterial]]:
    async with nueva_sesion() as s:
        m = await s.get(Material, mid)
        if m is None or m.tipo != "apuntes":
            raise ValueError("no son unos apuntes")
        bloques = (await s.scalars(select(BloqueMaterial).where(BloqueMaterial.material_id == mid))).all()
    orden = {b["clave"]: i for i, b in enumerate((m.contrato or {}).get("bloques", []))}
    return m, sorted(bloques, key=lambda b: orden.get(b.clave, 99))


def _version(m: Material) -> str:
    return m.actualizado_en.isoformat() if getattr(m, "actualizado_en", None) else str(m.id)


async def alumno(plan_id: int) -> str:
    """Quién lee: nivel y objetivo del plan, y lo ajustado en la mascota."""
    from magister.flujo.comun import preferencias_tutor

    async with nueva_sesion() as s:
        perfil = await s.scalar(text("select perfil from planes where id = :p"), {"p": plan_id}) or {}
    p = await preferencias_tutor()
    partes = []
    if perfil.get("nivel"):
        partes.append(f"Nivel previo en el tema: {perfil['nivel']}.")
    if perfil.get("objetivo"):
        partes.append(f"Para qué lo estudia: {perfil['objetivo']}.")
    if p.get("nivel") == "cero":
        partes.append("Quiere que le expliquen desde cero.")
    elif p.get("nivel") == "experto":
        partes.append("Tiene nivel avanzado en general.")
    partes += [f"Pide: {x}" for x in p.get("instrucciones") or []]
    return "\n".join(partes) or "Adulto con formación, sin conocimientos previos del tema."


def _texto(bloques: list[BloqueMaterial], titulos: dict[str, str], solo: list[str] | None = None) -> str:
    return "\n\n".join(f"## {b.clave} · {titulos.get(b.clave, b.titulo)}\n{b.texto}" for b in bloques if not solo or b.clave in solo)


# ---- Calentamiento ----

class FraseApartado(BaseModel):
    clave: str
    frase: str


class Priming(BaseModel):
    resumen: list[str] = Field(min_length=5, max_length=5)
    apartados: list[FraseApartado]
    preguntas: list[str] = Field(min_length=1, max_length=3)


async def priming(mid: int) -> dict:
    m, bloques = await _material(mid)
    clave = f"priming_{mid}"
    hecho = await _leer(clave)
    if hecho and hecho.get("version") == _version(m):
        return hecho
    titulos = {b["clave"]: b["titulo"] for b in (m.contrato or {}).get("bloques", [])}
    sistema = cargar("priming").rellenar(alumno=await alumno(m.plan_id), apuntes=_texto(bloques, titulos)[:30000])
    r = await estructurar(sistema, "Devuelve el calentamiento.", Priming)
    valor = {**r.model_dump(), "apartados": {a.clave: a.frase for a in r.apartados}, "version": _version(m)}
    await _guardar(clave, valor)
    return valor


# ---- Dímelo más fácil ----

class Facil(BaseModel):
    frases: list[str] = Field(min_length=3, max_length=3)


async def facil(mid: int, clave_bloque: str) -> dict:
    m, bloques = await _material(mid)
    b = next((x for x in bloques if x.clave == clave_bloque), None)
    if b is None:
        raise ValueError("ese apartado no existe")
    clave = f"facil_{mid}_{clave_bloque}"
    hecho = await _leer(clave)
    if hecho and hecho.get("version") == _version(m):
        return hecho
    titulos = {x["clave"]: x["titulo"] for x in (m.contrato or {}).get("bloques", [])}
    sistema = cargar("facil").rellenar(alumno=await alumno(m.plan_id), titulo=titulos.get(b.clave, b.titulo), texto=b.texto)
    r = await estructurar(sistema, "Devuelve las tres frases.", Facil)
    valor = {"frases": r.frases, "version": _version(m)}
    await _guardar(clave, valor)
    return valor


# ---- Banco del examen oral ----

class BancoOral(BaseModel):
    panoramica: list[str] = Field(min_length=2, max_length=5)
    secciones: list[str] = Field(min_length=2, max_length=14)
    profundizacion: list[str] = Field(min_length=2, max_length=5)


async def banco_oral(mid: int, rehacer: bool = False) -> dict:
    m, bloques = await _material(mid)
    clave = f"oral_{mid}"
    hecho = await _leer(clave)
    if hecho and hecho.get("version") == _version(m) and not rehacer:
        return hecho
    titulos = {b["clave"]: b["titulo"] for b in (m.contrato or {}).get("bloques", [])}
    sistema = cargar("oral_banco").rellenar(alumno=await alumno(m.plan_id), apuntes=_texto(bloques, titulos)[:30000])
    r = await estructurar(sistema, "Devuelve el banco de preguntas.", BancoOral)
    valor = {**r.model_dump(), "version": _version(m)}
    await _guardar(clave, valor)
    return valor


# ---- Repaso del tema (volcado) ----

class Apartado(BaseModel):
    clave: str
    estado: Literal["bien", "flojo", "falta"]
    comentario: str = ""


class ErrorVolcado(BaseModel):
    dijo: str
    correcto: str


class CorreccionVolcado(BaseModel):
    ordenado: str
    nota: float = Field(ge=0, le=10)
    apartados: list[Apartado]
    errores: list[ErrorVolcado] = Field(default_factory=list)
    siguiente: str


async def apuntes_de_leccion(plan_id: int, clave: str) -> int:
    async with nueva_sesion() as s:
        mid = await s.scalar(text(
            "select id from materiales where plan_id = :p and leccion_clave = :c and tipo = 'apuntes' and estado in ('listo', 'revisar') "
            "order by id desc limit 1"), {"p": plan_id, "c": clave})
    if mid is None:
        raise ValueError("esa lección aún no tiene apuntes")
    return mid


async def corregir_volcado(plan_id: int, clave: str, recuerdo: str, alcance: list[str] | None = None,
                           guardar: bool = True) -> dict:
    mid = await apuntes_de_leccion(plan_id, clave)
    m, bloques = await _material(mid)
    titulos = {b["clave"]: b["titulo"] for b in (m.contrato or {}).get("bloques", [])}
    exigencia = ("Es un repaso a mitad de sesión: corrige solo los apartados indicados." if alcance else
                 "Es el repaso del tema completo.")
    from magister.seguridad.entrada import neutralizar_etiquetas

    # Lo que cuenta el alumno va entre etiquetas: no puede cerrarlas.
    sistema = cargar("volcado").rellenar(apuntes=_texto(bloques, titulos, alcance)[:30000],
                                         recuerdo=neutralizar_etiquetas(recuerdo[:12000]), exigencia=exigencia)
    r = await estructurar(sistema, "Devuelve la corrección.", CorreccionVolcado)
    salida = r.model_dump()
    salida["apartados"] = [{**a, "titulo": titulos.get(a["clave"], a["clave"])} for a in salida["apartados"]]
    salida["material_id"] = mid
    if guardar and not alcance:  # solo el repaso del tema completo cuenta para el calendario de repasos del tema
        historial = (await _leer(f"volcados_{plan_id}_{clave}")) or []
        historial.append({"fecha": datetime.now(timezone.utc).isoformat(timespec="minutes"), "nota": r.nota,
                          "flojos": [a.clave for a in r.apartados if a.estado != "bien"]})
        await _guardar(f"volcados_{plan_id}_{clave}", historial[-20:])
    return salida


async def apartados_flojos() -> list[tuple[int, str, list[str]]]:
    """(plan, lección, claves de apartados) que quedaron flojos o faltaron en el último repaso del tema."""
    from magister.datos.produccion import Ajuste

    async with nueva_sesion() as s:
        filas = (await s.execute(select(Ajuste.clave, Ajuste.valor).where(Ajuste.clave.like("volcados_%")))).all()
    salida = []
    for k, v in filas:
        _, plan, leccion = k.split("_", 2)
        if v and v[-1].get("flojos"):
            salida.append((int(plan), leccion, v[-1]["flojos"]))
    return salida


async def repasos_de_tema(hoy: date | None = None) -> list[dict]:
    """Lecciones estudiadas con su próximo repaso del tema: 2, 5, 7, 14, 21 y 30 días tras el anterior
    (o tras estudiarla). Si hay un examen del plan cerca, no más de un día antes de él."""
    hoy = hoy or date.today()
    async with nueva_sesion() as s:
        filas = (await s.execute(text(
            "select s.plan_id, s.leccion_clave, l.titulo, max(s.fecha) from sesiones s join lecciones l on l.plan_id = s.plan_id "
            "and l.clave = s.leccion_clave join planes p on p.id = s.plan_id and p.estado = 'aceptado' "
            "where s.estado = 'hecha' group by 1, 2, 3, l.orden order by s.plan_id, l.orden"))).all()
    salida = []
    for plan_id, clave, titulo, estudiada in filas:
        historial = (await _leer(f"volcados_{plan_id}_{clave}")) or []
        n = len(historial)
        ultimo = date.fromisoformat(historial[-1]["fecha"][:10]) if historial else estudiada
        toca = ultimo + timedelta(days=INTERVALOS_TEMA[min(n, len(INTERVALOS_TEMA) - 1)])
        try:
            mid = await apuntes_de_leccion(plan_id, clave)
        except ValueError:
            continue
        salida.append({"plan_id": plan_id, "clave": clave, "titulo": titulo, "toca": toca.isoformat(), "vencido": toca <= hoy,
                       "hechos": n, "ultima_nota": historial[-1]["nota"] if historial else None, "material_id": mid})
    return salida


async def estilo_examen(plan_id: int) -> str:
    guardado = await _leer(f"estilo_examen_{plan_id}")
    if guardado in ESTILOS_EXAMEN:
        return guardado
    async with nueva_sesion() as s:
        perfil = await s.scalar(text("select perfil from planes where id = :p"), {"p": plan_id}) or {}
    return "oral" if "entrevista" in str(perfil.get("objetivo", "")).lower() else "desarrollo"


async def poner_estilo_examen(plan_id: int, estilo: str) -> str:
    if estilo not in ESTILOS_EXAMEN:
        raise ValueError("estilo desconocido")
    await _guardar(f"estilo_examen_{plan_id}", estilo)
    return estilo



# ---- La mascota, compañera de lectura: ayuda con un párrafo ----

PEDIDOS = {
    "facil": "Dímelo más fácil: lo mismo que dice el párrafo, en palabras sencillas.",
    "ejemplo": "Un ejemplo concreto y cotidiano de lo que dice el párrafo.",
    "porque": "¿Por qué es así? La razón de fondo de lo que afirma el párrafo.",
    "clave": "Las 2 o 3 palabras clave del párrafo y cómo se conectan, en una frase.",
    "codigo": "Explícame este código línea a línea, en frases cortas: qué hace cada parte y para qué.",
}


async def ayuda_parrafo(mid: int, clave_bloque: str, parrafo: str, accion: str, pregunta: str | None = None) -> str:
    """Una respuesta corta sobre un párrafo. Las de serie (fácil, ejemplo, por qué, clave) se guardan."""
    import hashlib

    from magister.cerebro.modelo import Turno, generar

    m, bloques = await _material(mid)
    b = next((x for x in bloques if x.clave == clave_bloque), None)
    if b is None:
        raise ValueError("ese apartado no existe")
    if accion in ("pregunta", "comprobar") and not (pregunta or "").strip():
        raise ValueError("falta la pregunta")
    huella = hashlib.sha256(f"{accion}|{parrafo}".encode()).hexdigest()[:16]
    clave = f"parrafo_{mid}_{huella}"
    if accion not in ("pregunta", "comprobar"):
        hecho = await _leer(clave)
        if hecho and hecho.get("version") == _version(m):
            return hecho["texto"]
    from magister.seguridad.entrada import neutralizar_etiquetas

    # El párrafo y la pregunta llegan de la web: nada en ellos puede cerrar las etiquetas del prompt.
    pregunta = neutralizar_etiquetas(pregunta) if pregunta else pregunta
    titulos = {x["clave"]: x["titulo"] for x in (m.contrato or {}).get("bloques", [])}
    pedido = PEDIDOS.get(accion) or (
        f"Ha explicado con sus palabras lo que acaba de leer: «{pregunta}». Dile si lo ha entendido (sé concreto) y, si le "
        "falta algo esencial o se equivoca, qué en una frase. Si está bien, díselo y añade un matiz que lo enriquezca."
        if accion == "comprobar" else f"Su pregunta sobre el párrafo: {pregunta}")
    sistema = cargar("parrafo").rellenar(pedido=pedido, alumno=await alumno(m.plan_id), titulo=titulos.get(b.clave, b.titulo),
                                         apartado=b.texto[:8000], parrafo=neutralizar_etiquetas(parrafo[:3000]))
    texto = "".join([t async for t in generar(sistema, [Turno("usuario", pregunta or pedido)])]).strip()
    if accion not in ("pregunta", "comprobar"):
        await _guardar(clave, {"texto": texto, "version": _version(m)})
    return texto


# ---- La pizarra de la llamada: un diagrama por apartado ----

def extraer_svg(texto: str) -> str | None:
    """El primer SVG completo de un texto (dentro de un bloque ```svg o suelto), o None."""
    import re

    m = re.search(r"<svg\b[\s\S]*?</svg>", texto)
    return m.group(0) if m else None


async def diagrama_apartado(mid: int, clave_bloque: str) -> dict:
    """El diagrama de un apartado para la pizarra de la llamada: el suyo si los apuntes ya lo traen; si no, lo dibuja el
    modelo una vez y se guarda. `svg` es None cuando un dibujo no aclara nada."""
    from magister.cerebro.modelo import Turno, generar

    m, bloques = await _material(mid)
    b = next((x for x in bloques if x.clave == clave_bloque), None)
    if b is None:
        raise ValueError("ese apartado no existe")
    propio = extraer_svg(b.texto)
    if propio:
        return {"svg": propio}
    clave = f"diagrama_{mid}_{clave_bloque}"
    hecho = await _leer(clave)
    if hecho and hecho.get("version") == _version(m):
        return {"svg": hecho.get("svg")}
    titulos = {x["clave"]: x["titulo"] for x in (m.contrato or {}).get("bloques", [])}
    sistema = cargar("diagrama_apartado").rellenar(titulo=titulos.get(b.clave, b.titulo), texto=b.texto[:8000])
    respuesta = "".join([t async for t in generar(sistema, [Turno("usuario", "Dibuja el diagrama o responde NADA.")])])
    svg = extraer_svg(respuesta)
    await _guardar(clave, {"svg": svg, "version": _version(m)})
    return {"svg": svg}


# ---- Mapa de conceptos: lo hace el modelo leyendo la lección y luego lo retocas tú ----

# El lienzo del mapa en la web (MapaConceptos.tsx usa las mismas medidas).
ANCHO_MAPA = 720
ALTO_MAPA = 540


class RelacionMapa(BaseModel):
    de: str
    a: str
    etiqueta: str = ""


class MapaAuto(BaseModel):
    conceptos: list[str] = Field(min_length=3, max_length=14)
    relaciones: list[RelacionMapa] = Field(min_length=2, max_length=24)


def _ancho_nodo(texto: str) -> float:
    return max(60.0, len(texto) * 7.2 + 20)


def colocar_mapa(conceptos: list[str], relaciones: list[RelacionMapa]) -> dict:
    """Monta el mapa a partir de lo que dice el modelo: quita repetidos y uniones a conceptos que no existen, y
    coloca los nodos por niveles desde la idea central (el primer concepto), con cada nivel repartido a lo ancho."""
    textos: list[str] = []
    for c in conceptos:
        t = " ".join(c.split())[:40]
        if t and not any(t.lower() == x.lower() for x in textos):
            textos.append(t)
    indice = {t.lower(): k for k, t in enumerate(textos)}
    flechas: list[dict] = []
    vecinos: dict[int, list[int]] = {k: [] for k in range(len(textos))}
    for r in relaciones:
        de, a = indice.get(" ".join(r.de.split()).lower()), indice.get(" ".join(r.a.split()).lower())
        if de is None or a is None or de == a or any(f["de"] == f"c{de}" and f["a"] == f"c{a}" for f in flechas):
            continue
        flechas.append({"de": f"c{de}", "a": f"c{a}", "etiqueta": " ".join(r.etiqueta.split())[:30]})
        vecinos[de].append(a)
        vecinos[a].append(de)

    # Niveles: recorrido en anchura desde la idea central; lo que quede suelto va al final.
    nivel = {0: 0} if textos else {}
    cola = [0] if textos else []
    while cola:
        k = cola.pop(0)
        for v in vecinos[k]:
            if v not in nivel:
                nivel[v] = nivel[k] + 1
                cola.append(v)
    hondo = max(nivel.values(), default=0) + 1
    por_nivel: dict[int, list[int]] = {}
    for k in range(len(textos)):
        por_nivel.setdefault(nivel.get(k, hondo), []).append(k)

    # Cada nivel en tantas filas como haga falta para que quepa a lo ancho.
    hueco = 24
    filas: list[list[int]] = []
    for n in sorted(por_nivel):
        fila: list[int] = []
        for k in por_nivel[n]:
            if fila and sum(_ancho_nodo(textos[j]) + hueco for j in fila) + _ancho_nodo(textos[k]) > ANCHO_MAPA:
                filas.append(fila)
                fila = []
            fila.append(k)
        filas.append(fila)

    alto_nodo = 32
    paso = min(110.0, (ALTO_MAPA - 2 * hueco - alto_nodo) / max(1, len(filas) - 1))
    nodos: dict[int, dict] = {}
    for r, fila in enumerate(filas):
        y = hueco + r * paso if len(filas) > 1 else (ALTO_MAPA - alto_nodo) / 2
        anchos = [_ancho_nodo(textos[k]) for k in fila]
        # El espacio sobrante se reparte entre los huecos, para que la fila ocupe el ancho y se lea mejor.
        libre = ANCHO_MAPA - sum(anchos)
        separacion = max(0.0, libre / (len(fila) + 1))
        x = separacion
        for k, ancho in zip(fila, anchos, strict=True):
            nodos[k] = {"id": f"c{k}", "texto": textos[k], "x": round(max(0.0, min(ANCHO_MAPA - ancho, x)), 1), "y": round(y, 1)}
            x += ancho + separacion
    return {"nodos": [nodos[k] for k in range(len(textos))], "flechas": flechas}


async def generar_mapa(mid: int) -> dict:
    """Lee la lección entera, saca los conceptos clave y sus relaciones, y deja el mapa como el tuyo."""
    m, bloques = await _material(mid)
    titulos = {b["clave"]: b["titulo"] for b in (m.contrato or {}).get("bloques", [])}
    sistema = cargar("mapa").rellenar(alumno=await alumno(m.plan_id), apuntes=_texto(bloques, titulos)[:30000])
    r = await estructurar(sistema, "Devuelve el mapa de conceptos.", MapaAuto)
    mapa = colocar_mapa(r.conceptos, r.relaciones)
    await _guardar(f"mapa_{mid}", mapa)
    return mapa


async def ver_mapa(mid: int) -> dict:
    return (await _leer(f"mapa_{mid}")) or {"nodos": [], "flechas": []}


async def guardar_mapa(mid: int, mapa: dict) -> dict:
    await _guardar(f"mapa_{mid}", mapa)
    return mapa
