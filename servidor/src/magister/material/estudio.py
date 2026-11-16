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
    sistema = cargar("volcado").rellenar(apuntes=_texto(bloques, titulos, alcance)[:30000], recuerdo=recuerdo[:12000], exigencia=exigencia)
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
}


async def ayuda_parrafo(mid: int, clave_bloque: str, parrafo: str, accion: str, pregunta: str | None = None) -> str:
    """Una respuesta corta sobre un párrafo. Las de serie (fácil, ejemplo, por qué, clave) se guardan."""
    import hashlib

    from magister.cerebro.modelo import Turno, generar

    m, bloques = await _material(mid)
    b = next((x for x in bloques if x.clave == clave_bloque), None)
    if b is None:
        raise ValueError("ese apartado no existe")
    if accion == "pregunta" and not (pregunta or "").strip():
        raise ValueError("falta la pregunta")
    huella = hashlib.sha256(f"{accion}|{parrafo}".encode()).hexdigest()[:16]
    clave = f"parrafo_{mid}_{huella}"
    if accion != "pregunta":
        hecho = await _leer(clave)
        if hecho and hecho.get("version") == _version(m):
            return hecho["texto"]
    titulos = {x["clave"]: x["titulo"] for x in (m.contrato or {}).get("bloques", [])}
    pedido = PEDIDOS.get(accion) or f"Su pregunta sobre el párrafo: {pregunta}"
    sistema = cargar("parrafo").rellenar(pedido=pedido, alumno=await alumno(m.plan_id), titulo=titulos.get(b.clave, b.titulo),
                                         apartado=b.texto[:8000], parrafo=parrafo[:3000])
    texto = "".join([t async for t in generar(sistema, [Turno("usuario", pregunta or pedido)])]).strip()
    if accion != "pregunta":
        await _guardar(clave, {"texto": texto, "version": _version(m)})
    return texto


# ---- Tu mapa de palabras clave (lo construyes tú mientras estudias) ----

async def ver_mapa(mid: int) -> dict:
    return (await _leer(f"mapa_{mid}")) or {"nodos": [], "flechas": []}


async def guardar_mapa(mid: int, mapa: dict) -> dict:
    await _guardar(f"mapa_{mid}", mapa)
    return mapa
