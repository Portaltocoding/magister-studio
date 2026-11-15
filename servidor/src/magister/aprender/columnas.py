"""Las columnas del modelo de olvido, calculadas con lo que existía en cada momento.

Solo leen el estado (`estado_en` / `estado_de`), que solo ve intentos anteriores: ni la
confianza, ni la latencia, ni la tabla `oraculo` del simulador.
"""

import math
from datetime import datetime

from sqlalchemy import text

from magister.aprender.estado import EstadoConcepto, es_acierto, estado_de

COLUMNAS = ["log1p_delta", "aciertos", "fallos", "raiz_aciertos", "raiz_fallos", "primer_repaso", "tasa_previa"]
SUAVIZADO = 5


def fila(estado: EstadoConcepto, momento: datetime, tasa_global: float) -> dict:
    delta = estado.dias_desde if estado.dias_desde is not None else 0.0
    a, f = estado.aciertos, estado.fallos
    return {
        "log1p_delta": math.log1p(max(0.0, delta)),
        "aciertos": a,
        "fallos": f,
        "raiz_aciertos": math.sqrt(a),
        "raiz_fallos": math.sqrt(f),
        "primer_repaso": 1 if a + f == 0 else 0,
        "tasa_previa": (a + SUAVIZADO * tasa_global) / (a + f + SUAVIZADO),
    }


async def features_en(concepto_id: str, momento: datetime, tasa_global: float = 0.7) -> dict:
    from magister.aprender.estado import estado_en

    return fila(await estado_en(concepto_id, momento), momento, tasa_global)


async def tabla(desde: datetime | None = None, hasta: datetime | None = None, s=None):
    """(X, y, momentos, extra) de los intentos `espaciado`, en orden de momento. `extra` lleva el
    concepto, el id y la nota, para los programadores que se comparan con el modelo."""
    consulta = text(
        "select id, concepto_id, momento, nota_corrector, nota_usuario from intentos where tipo = 'espaciado' order by momento"
    )
    if s is None:
        from magister.datos.sesion import nueva_sesion

        async with nueva_sesion() as s2:
            filas = (await s2.execute(consulta)).all()
    else:
        filas = (await s.execute(consulta)).all()
    historia: dict[str, list] = {}
    X, y, momentos, extra = [], [], [], []
    aciertos_totales, vistos = 0, 0
    for iid, cid, m, nc, nu in filas:
        previos = historia.setdefault(cid, [])
        estado = estado_de(cid, m, previos)
        tasa_global = (aciertos_totales + 0.7 * 10) / (vistos + 10)
        nota = nu or nc
        if (desde is None or m >= desde) and (hasta is None or m < hasta):
            X.append([fila(estado, m, tasa_global)[c] for c in COLUMNAS])
            y.append(int(es_acierto(nota)))
            momentos.append(m)
            extra.append({"id": iid, "concepto_id": cid, "estado": estado, "nota": nota})
        previos.append((m, nc, nu, "espaciado"))
        aciertos_totales += int(es_acierto(nota))
        vistos += 1
    return X, y, momentos, extra
