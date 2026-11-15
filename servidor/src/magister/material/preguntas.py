"""Las preguntas de repaso con respuesta fantasma, y su auditoría sin modelo."""

import re
from collections import Counter

from sqlalchemy import delete, select

from magister.cerebro.estructura import estructurar
from magister.cerebro.prompts import cargar
from magister.datos.material import Pregunta, PreguntaConcepto
from magister.datos.sesion import nueva_sesion
from magister.material.modelos import EntradaMaterial, ListaPreguntas, PreguntaGen
from magister.material.preferencias import texto_preguntas
from magister.tono.hallazgo import Hallazgo

FANTASMA_MIN, FANTASMA_MAX = 40, 90
TIPOS_MIN = 3  # mezcla mínima de tipos distintos
RELLENO = re.compile(r"\b(lorem|ipsum|xxx|rellenar|todo:|pendiente de escribir)\b", re.I)
UMBRAL_DUPLICADO = 0.85  # coseno; se ajusta con evals/duplicados/umbral.py


def _reglas(entrada: EntradaMaterial, claves_bloques: set[str]):
    ids = {c.id for c in entrada.conceptos}

    def aplicar(lista: ListaPreguntas) -> list[str]:
        errores = []
        for i, p in enumerate(lista.preguntas, start=1):
            malos = [c for c in p.conceptos if c not in ids]
            if malos:
                errores.append(f"pregunta {i}: conceptos que no son de la lección: {malos}")
            if claves_bloques and p.donde not in claves_bloques:
                errores.append(f"pregunta {i}: «donde» = {p.donde} no es un bloque ({sorted(claves_bloques)})")
        return errores

    return aplicar


async def generar_preguntas(entrada: EntradaMaterial, apuntes: str, claves_bloques: set[str]) -> list[PreguntaGen]:
    conceptos = "\n".join(f"- {c.id}: {c.nombre} · {'núcleo' if c.nucleo else 'ampliación'}" for c in entrada.conceptos)
    sistema = cargar("preguntas").rellenar(conceptos=conceptos, apuntes=apuntes[:20000],
                                         preferencias=texto_preguntas(entrada.preferencias))
    lista = await estructurar(sistema, "Devuelve las preguntas.", ListaPreguntas, _reglas(entrada, claves_bloques))
    return lista.preguntas


def _palabras(t: str) -> set[str]:
    return {p for p in re.findall(r"\w+", t.lower()) if len(p) > 3}


def similitud(a: str, b: str) -> float:
    """Aproximación barata del coseno sobre conjuntos de palabras (sin modelo)."""
    pa, pb = _palabras(a), _palabras(b)
    if not pa or not pb:
        return 0.0
    return len(pa & pb) / ((len(pa) * len(pb)) ** 0.5)


def auditar(preguntas: list[dict], entrada: EntradaMaterial, claves_bloques: set[str]) -> list[Hallazgo]:
    """Errores: id duplicado, `donde` inexistente, concepto del núcleo sin pregunta.
    Avisos: fantasma fuera de 40 a 90 palabras, poca mezcla, relleno y pares casi duplicados."""
    h: list[Hallazgo] = []

    def nota(regla: str, cita: str, por_que: str, gravedad: str) -> None:
        h.append(Hallazgo(cita=cita or regla, regla=regla, por_que=por_que, gravedad=gravedad, origen="auditoria"))  # type: ignore[arg-type]

    repetidos = [i for i, n in Counter(p["id"] for p in preguntas).items() if n > 1]
    for i in repetidos:
        nota("id_duplicado", i, "dos preguntas con el mismo id", "veto")
    for p in preguntas:
        if claves_bloques and p["donde"] not in claves_bloques:
            nota("donde_inexistente", p["donde"], f"«{p['id']}» apunta a un bloque que no existe", "veto")
        n = len(p["fantasma"].split())
        if not FANTASMA_MIN <= n <= FANTASMA_MAX:
            nota("fantasma_longitud", p["fantasma"][:80], f"la fantasma tiene {n} palabras ({FANTASMA_MIN} a {FANTASMA_MAX})", "aviso")
        for campo in ("enunciado", "fantasma"):
            m = RELLENO.search(p[campo])
            if m:
                nota("relleno", m.group(0), f"texto de relleno en {campo}", "aviso")
    cubiertos = {c for p in preguntas for c in p["conceptos"]}
    for c in entrada.conceptos:
        if c.nucleo and c.id not in cubiertos:
            nota("nucleo_sin_pregunta", c.nombre, f"el concepto del núcleo «{c.id}» no tiene pregunta", "veto")
    if len({p["tipo"] for p in preguntas}) < min(TIPOS_MIN, len(preguntas)):
        nota("mezcla", preguntas[0]["tipo"] if preguntas else "-", "poca variedad de tipos", "aviso")
    for i, a in enumerate(preguntas):
        for b in preguntas[i + 1 :]:
            s = similitud(a["enunciado"], b["enunciado"])
            if s >= UMBRAL_DUPLICADO:
                nota("casi_duplicada", b["enunciado"][:80], f"se parece a «{a['id']}» ({s:.2f})", "aviso")
    return h


async def guardar_preguntas(entrada: EntradaMaterial, material_id: int | None, preguntas: list[PreguntaGen]) -> list[dict]:
    filas = []
    for n, p in enumerate(preguntas, start=1):
        filas.append({"id": f"p-{entrada.plan_id}-{entrada.leccion_clave}-{n:02d}", "plan_id": entrada.plan_id,
                      "leccion_clave": entrada.leccion_clave, "material_id": material_id, "tipo": p.tipo,
                      "enunciado": p.enunciado, "fantasma": p.fantasma, "donde": p.donde, "conceptos": p.conceptos})
    async with nueva_sesion() as s, s.begin():
        viejas = select(Pregunta.id).where(Pregunta.plan_id == entrada.plan_id, Pregunta.leccion_clave == entrada.leccion_clave)
        await s.execute(delete(PreguntaConcepto).where(PreguntaConcepto.pregunta_id.in_(viejas)))
        await s.execute(delete(Pregunta).where(Pregunta.plan_id == entrada.plan_id, Pregunta.leccion_clave == entrada.leccion_clave))
        for f in filas:
            s.add(Pregunta(**{k: v for k, v in f.items() if k != "conceptos"}, estado="activa"))
        await s.flush()
        for f in filas:
            for c in dict.fromkeys(f["conceptos"]):
                s.add(PreguntaConcepto(pregunta_id=f["id"], plan_id=entrada.plan_id, concepto_id=c))
    return filas
