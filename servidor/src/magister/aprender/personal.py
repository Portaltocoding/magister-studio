"""Tu modelo de olvido: FSRS ajustado a tus propios repasos, por escalones y sin empeorar nunca.

Escalones (los de Anki/fsrs-rs, resumidos en engram docs/13 §2.6):
- Menos de 8 conceptos con dos repasos o más: parámetros por defecto. Ajustar con menos datos es adivinar.
- Desde 8: solo las cuatro estabilidades iniciales (cuánto aguanta un concepto tras el primer repaso, según la
  nota). Es lo que más pesa: recoge más de la mitad de la mejora de un ajuste completo.
- Desde 64: el vector entero con el optimizador de `fsrs` (necesita `pandas`; si falta, se queda en el escalón
  inicial y lo dice).
Un ajuste solo se acepta si predice tus aciertos mejor que el anterior (pérdida logarítmica sobre tus repasos).
Lo guardado lleva la marca del mapeo de notas (`programador.MARCA_NOTAS`): unos parámetros ajustados con otro mapeo
no se usan, y el siguiente ajuste se compara con los de por defecto.
El cálculo es CPU: va en un hilo aparte para no bloquear la API.
"""

import asyncio
import hashlib
import math
from datetime import datetime, timezone

from sqlalchemy import text

from magister.aprender.estado import es_acierto, nota_final
from magister.aprender.programador import MARCA_NOTAS
from magister.datos.sesion import nueva_sesion

UMBRAL_INICIAL = 8
UMBRAL_COMPLETO = 64
CLAVE = "fsrs_personal"
NOTAS = {"fallo": 1, "parcial": 1, "bien": 3, "perfecta": 4}  # el mismo mapeo que `programador.NOTAS_FSRS`

_personal: dict | None = None


def parametros_guardados() -> dict | None:
    """Lo que usa el programador (sin tocar la base: se carga al arrancar y al ajustar)."""
    return _personal


async def cargar() -> None:
    global _personal
    from magister.datos.produccion import Ajuste

    async with nueva_sesion() as s:
        fila = await s.get(Ajuste, CLAVE)
    v = (fila.valor if fila else None) or {}
    _personal = v if vigente(v) else None


def vigente(valor: dict) -> bool:
    """Si unos parámetros guardados se pueden usar: activos y ajustados con el mapeo de notas de ahora."""
    return bool(valor.get("activo") and valor.get("parametros") and valor.get("notas") == MARCA_NOTAS)


async def series(con_extras: bool = False) -> list[list[tuple]]:
    """Por concepto, sus repasos espaciados (el primero de cada día), en orden: (momento, nota) o, con extras,
    (momento, nota, confianza, latencia_ms)."""
    async with nueva_sesion() as s:
        filas = (await s.execute(text(
            "select plan_id, concepto_id, momento, nota_corrector, nota_usuario, confianza, latencia_ms from intentos "
            "where tipo = 'espaciado' order by plan_id, concepto_id, momento"))).all()
    por: dict[tuple, list] = {}
    for plan_id, cid, momento, nc, nu, conf, lat in filas:
        lista = por.setdefault((plan_id, cid), [])
        if not lista or lista[-1][0].date() != momento.date():
            lista.append((momento, nota_final(nc, nu), conf, lat) if con_extras else (momento, nota_final(nc, nu)))
    return list(por.values())


def _perdida(parametros: tuple[float, ...] | None, datos: list[list[tuple[datetime, str]]]) -> tuple[float, int]:
    """Pérdida logarítmica media de predecir cada repaso (desde el segundo) con esos parámetros."""
    from fsrs import Card, Rating, Scheduler

    sch = Scheduler(learning_steps=(), relearning_steps=(), enable_fuzzing=False,
                    **({"parameters": parametros} if parametros else {}))
    total, n = 0.0, 0
    for serie in datos:
        c = Card()
        for k, (momento, nota) in enumerate(serie):
            if k > 0:
                p = min(max(float(sch.get_card_retrievability(c, momento)), 1e-4), 1 - 1e-4)
                y = 1.0 if es_acierto(nota) else 0.0
                total -= y * math.log(p) + (1 - y) * math.log(1 - p)
                n += 1
            c, _ = sch.review_card(c, Rating(NOTAS[nota]), momento)
    return (total / n if n else float("inf")), n


def _ajustar_iniciales(datos: list[list[tuple[datetime, str]]]) -> tuple[float, ...]:
    """Estabilidad inicial por nota, por máxima verosimilitud del segundo repaso, con un tirón hacia el valor por
    defecto (en escala logarítmica) para no fiarse de pocos datos, y monótona (mejor nota, más estabilidad)."""
    from fsrs.scheduler import DEFAULT_PARAMETERS

    w = list(DEFAULT_PARAMETERS)
    decay = w[20]
    factor = 0.9 ** (-1 / decay) - 1
    pares: dict[int, list[tuple[float, float]]] = {1: [], 2: [], 3: [], 4: []}
    for serie in datos:
        if len(serie) < 2:
            continue
        (t0, n0), (t1, n1) = serie[0], serie[1]
        dias = max((t1 - t0).total_seconds() / 86400, 0.01)
        pares[NOTAS[n0]].append((dias, 1.0 if es_acierto(n1) else 0.0))
    rejilla = [0.05 * (1.12 ** k) for k in range(80)]  # de 0,05 a ~350 días
    for r, lista in pares.items():
        if not lista:
            continue
        defecto = w[r - 1]

        def coste(s: float) -> float:
            c = 0.0
            for dias, y in lista:
                p = min(max((1 + factor * dias / s) ** (-decay), 1e-4), 1 - 1e-4)
                c -= y * math.log(p) + (1 - y) * math.log(1 - p)
            return c + 0.5 * (math.log(s) - math.log(defecto)) ** 2

        w[r - 1] = min(rejilla, key=coste)
    for r in range(1, 4):  # monótona
        w[r] = max(w[r], w[r - 1])
    return tuple(w)


def _ajustar_completo(datos: list[list[tuple[datetime, str]]]) -> tuple[float, ...] | None:
    try:
        import pandas  # noqa: F401
        from fsrs import Optimizer, Rating, ReviewLog
    except ImportError:
        return None
    logs = []
    for k, serie in enumerate(datos):
        for momento, nota in serie:
            logs.append(ReviewLog(card_id=k + 1, rating=Rating(NOTAS[nota]), review_datetime=momento, review_duration=None))
    return tuple(Optimizer(logs).compute_optimal_parameters())


def _calcular(datos, previos: tuple[float, ...] | None) -> dict:
    con_dos = sum(1 for x in datos if len(x) >= 2)
    if con_dos < UMBRAL_INICIAL:
        return {"hecho": False, "motivo": f"Aún no hay datos: {con_dos} de {UMBRAL_INICIAL} conceptos con dos repasos o más."}
    etapa, params = "inicial", None
    if con_dos >= UMBRAL_COMPLETO:
        params = _ajustar_completo(datos)
        if params is not None:
            etapa = "completo"
    if params is None:
        params = _ajustar_iniciales(datos)
    antes, n = _perdida(previos, datos)
    despues, _ = _perdida(params, datos)
    return {"hecho": despues < antes, "etapa": etapa, "parametros": list(params), "perdida_antes": round(antes, 4),
            "perdida_despues": round(despues, 4), "repasos_evaluados": n, "conceptos": con_dos,
            "motivo": None if despues < antes else "El ajuste no predice mejor que lo que ya había: me quedo como estaba."}


async def ajustar() -> dict:
    """Ajusta y, si mejora, lo guarda y lo pone en marcha."""
    global _personal
    from sqlalchemy.dialects.postgresql import insert

    from magister.aprender import programador as prog
    from magister.datos.produccion import Ajuste

    datos = await series()
    previos = tuple(_personal["parametros"]) if _personal else None
    r = await asyncio.to_thread(_calcular, datos, previos)
    if r.get("hecho"):
        valor = {**r, "activo": True, "notas": MARCA_NOTAS, "fecha": datetime.now(timezone.utc).isoformat(timespec="minutes"),
                 "huella": hashlib.sha256(repr(r["parametros"]).encode()).hexdigest()[:8]}
        async with nueva_sesion() as s, s.begin():
            await s.execute(insert(Ajuste).values(clave=CLAVE, valor=valor)
                            .on_conflict_do_update(index_elements=[Ajuste.clave], set_={"valor": valor}))
        _personal = valor
        prog.programador.cache_clear()
    return r


async def estado() -> dict:
    datos = await series()
    con_dos = sum(1 for x in datos if len(x) >= 2)
    repasos = sum(len(x) for x in datos)
    activo = {k: _personal.get(k) for k in ("etapa", "fecha", "perdida_antes", "perdida_despues", "conceptos")} if _personal else None
    red = _red_meta()
    return {
        "conceptos_con_repasos": len(datos), "conceptos_con_dos": con_dos, "repasos": repasos,
        "umbral_inicial": UMBRAL_INICIAL, "umbral_completo": UMBRAL_COMPLETO,
        "activo": activo, "red": red, "resumen": resumen(con_dos, activo, red),
    }


def resumen(con_dos: int, activo: dict | None, red: dict | None) -> dict:
    """En qué capa vas, qué falta para la siguiente y cómo decírtelo, en tres líneas. Pura: no lee la base ni la hora.
    `con_dos`: conceptos con dos repasos o más; `activo`: el ajuste en uso (con su `etapa`) o None; `red`: `_red_meta()`."""
    if not activo:
        capa = "estandar"
        primera = "Vas con el programador estándar, el mismo para todo el mundo."
        if con_dos < UMBRAL_INICIAL:
            faltan = UMBRAL_INICIAL - con_dos
            segunda = f"Cuando tengas {UMBRAL_INICIAL} conceptos repasados al menos dos veces lo ajusto a ti: llevas {con_dos}."
        else:
            faltan = 0
            segunda = f"Ya llevas {con_dos} conceptos repasados dos veces: lo ajusto a ti en cuanto el ajuste prediga mejor que él."
    elif activo.get("etapa") == "completo":
        capa, faltan = "completo", None
        primera = "Ajustado del todo a tus repasos."
        segunda = f"Con {activo.get('conceptos')} conceptos repasados dos veces o más; se reajusta solo cada día si mejora."
    else:
        capa = "inicial"
        primera = "Ajustado a tus repasos (solo lo básico: cuánto aguanta un concepto tras verlo por primera vez)."
        if con_dos < UMBRAL_COMPLETO:
            faltan = UMBRAL_COMPLETO - con_dos
            segunda = f"A los {UMBRAL_COMPLETO} conceptos afino el resto: llevas {con_dos}."
        else:
            faltan = 0
            segunda = f"Ya llevas {con_dos} conceptos: afino el resto en cuanto prediga mejor que lo básico."
    contra = "el ajuste" if activo else "el programador estándar"
    r = red or {}
    estado_red = r.get("estado") or "sin_datos"
    if estado_red == "activa":
        tercera = "Decide la red neuronal."
        if r.get("perdida_fsrs") and r.get("perdida_red") is not None:
            mejora = round(100 * (r["perdida_fsrs"] - r["perdida_red"]) / r["perdida_fsrs"])
            tercera = f"Decide la red neuronal: en tus últimos repasos predice un {mejora} % mejor que {contra}."
    elif estado_red == "sombra":
        necesaria = r.get("racha_necesaria") or 2
        if r.get("racha"):
            a_contra = "al ajuste" if activo else "al programador estándar"
            tercera = (f"La red neuronal va en sombra: ha ganado {r['racha']} de {necesaria} entrenamientos seguidos "
                       f"{a_contra}; el siguiente cuenta cuando haya repasos nuevos.")
        else:
            tercera = (f"La red neuronal va en sombra: aún no predice mejor que {contra}. Decide cuando le gane en "
                       f"{necesaria} entrenamientos seguidos.")
    else:
        tercera = (f"La red neuronal se entrena a partir de {r.get('minimo', 0)} repasos (sin contar el primero de cada "
                   f"concepto): llevas {r.get('repasos', 0)}.")
    return {"capa": capa, "faltan": faltan, "red": estado_red, "lineas": [primera, segunda, tercera]}


def _red_meta() -> dict | None:
    from magister.aprender import red

    m = red.meta()
    fijos = {"minimo": red.MIN_ENTRENAR + red.MIN_VALIDAR, "racha_necesaria": red.RACHA_NECESARIA}
    if not m:
        return {"estado": "sin_datos", "repasos": 0, "racha": 0} | fijos
    claves = ("estado", "repasos", "validacion", "perdida_fsrs", "perdida_red", "fecha", "faltan", "racha")
    return {k: m.get(k) for k in claves} | fijos
