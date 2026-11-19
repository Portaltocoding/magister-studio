"""Predecir el olvido: logística, walk-forward, calibración y la escalera de programadores.

    uv run python -m evals.olvido primera --simulado
    uv run python -m evals.olvido diagnostico --simulado
    uv run python -m evals.olvido walkforward --simulado [--calibrar]
    uv run python -m evals.olvido informe
    uv run python -m evals.olvido escalera
    uv run python -m evals.olvido capas --simulado

Con --simulado lee la base de simulación (MAGISTER_DB_URL_SIM); sin él, tus intentos.
Las predicciones fuera de muestra van a evals/olvido/predicciones-<fecha>.csv.
`capas` mide las tres capas del programador (FSRS por defecto, FSRS ajustado, la red) en el último cuarto de los
repasos, sin escribir nada: no guarda parámetros, ni la red, ni ficheros. Sale con código 1 si algo se rompe.
"""

import argparse
import asyncio
import csv
import sys
from datetime import date, timedelta
from pathlib import Path

import numpy as np

from evals.estadistica import auc, bootstrap_pareado, brier, calibracion, log_loss
from magister.aprender.programador import FSRS, Leitner

CARPETA = Path(__file__).parent / "olvido"


def _pipeline():
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import StandardScaler

    return Pipeline([("escala", StandardScaler()), ("logistica", LogisticRegression(max_iter=1000))])


async def _tabla(simulado: bool):
    from magister.aprender.columnas import tabla
    from magister.config import ajustes
    from magister.datos import sesion

    if simulado:
        sesion.configurar(ajustes.db_url_sim)
    X, y, m, extra = await tabla()
    await sesion.cerrar()
    if not X:
        raise SystemExit("No hay intentos. Con --simulado, corre antes `python -m magister.aprender.simular`.")
    return np.array(X, dtype=float), np.array(y), m, extra


def ece(p, y, tramos: int = 10) -> float:
    filas = calibracion(list(p), list(y), tramos)
    n = sum(x[2] for x in filas)
    return sum(abs(pr - ob) * k for pr, ob, k in filas) / n if n else 0.0


def _p_programadores(extra) -> dict[str, list[float]]:
    leitner, fsrs = Leitner(), FSRS()
    return {"leitner": [leitner.p_recordar(e["estado"], e["estado"].momento) for e in extra],
            "fsrs": [fsrs.p_recordar(e["estado"], e["estado"].momento) for e in extra]}


async def primera(simulado: bool) -> None:
    X, y, m, extra = await _tabla(simulado)
    dias = np.array([(x - m[0]).days for x in m])
    tr, te = dias < 90, (dias >= 90) & (dias < 120)
    if not te.any():
        te = dias >= np.percentile(dias, 75)
        tr = ~te
    modelo = _pipeline().fit(X[tr], y[tr])
    from magister.aprender.columnas import COLUMNAS

    print("Pesos:", dict(zip(COLUMNAS, np.round(modelo.named_steps["logistica"].coef_[0], 3), strict=True)))
    p = modelo.predict_proba(X[te])[:, 1]
    base = np.full(te.sum(), y[tr].mean())
    lt = np.array(_p_programadores([e for e, t in zip(extra, te, strict=True) if t])["leitner"])
    for nombre, q in [("logística", p), ("tasa base", base), ("leitner", lt)]:
        print(f"{nombre:<10} log-loss {log_loss(list(q), list(y[te])):.3f} · AUC {auc(list(q), list(y[te])):.3f}")


async def diagnostico(simulado: bool) -> None:
    X, *_ = await _tabla(simulado)
    from sklearn.preprocessing import StandardScaler

    print(f"Condición de X'X sin estandarizar: {np.linalg.cond(X.T @ X):.3g}")
    Z = StandardScaler().fit_transform(X)
    print(f"Condición de X'X estandarizada:    {np.linalg.cond(Z.T @ Z):.3g}")
    Xv = np.column_stack([X, X[:, 1] + X[:, 2]])  # vistas = aciertos + fallos: colineal a propósito
    print(f"Rango de X con «vistas»: {np.linalg.matrix_rank(Xv)} de {Xv.shape[1]} columnas")


async def walkforward(simulado: bool, calibrar: bool) -> None:
    X, y, m, extra = await _tabla(simulado)
    inicio = m[0].date()
    semanas = np.array([((x.date() - inicio).days) // 7 for x in m])
    progs = _p_programadores(extra)
    filas = []
    ultimo = None
    for k in range(4, semanas.max() + 1):
        # Un día de hueco entre train y validación.
        tr = semanas < k - (1 if calibrar else 0)
        tr &= np.array([x.date() < inicio + timedelta(days=7 * k - 1) for x in m])
        te = semanas == k
        if tr.sum() < 50 or not te.any() or len(set(y[tr])) < 2:
            continue
        modelo = _pipeline().fit(X[tr], y[tr])
        p_cruda = modelo.predict_proba(X[te])[:, 1]
        p_cal = p_cruda
        if calibrar:
            from sklearn.calibration import CalibratedClassifierCV
            from sklearn.frozen import FrozenEstimator

            val = semanas == k - 1
            if val.any() and len(set(y[val])) == 2:
                cal = CalibratedClassifierCV(FrozenEstimator(modelo), method="sigmoid").fit(X[val], y[val])
                p_cal = cal.predict_proba(X[te])[:, 1]
                ultimo = cal
        else:
            ultimo = modelo
        base = y[tr].mean()
        for i, idx in enumerate(np.where(te)[0]):
            momento = m[idx].isoformat()
            for nombre, p in [("base", base), ("leitner", progs["leitner"][idx]), ("fsrs", progs["fsrs"][idx]),
                              ("logistica", p_cruda[i]), ("logistica_calibrada", p_cal[i])]:
                filas.append({"momento": momento, "fila": int(idx), "modelo": nombre, "p": float(p), "y": int(y[idx])})
    CARPETA.mkdir(exist_ok=True)
    ruta = CARPETA / f"predicciones-{date.today().isoformat()}.csv"
    with ruta.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["momento", "fila", "modelo", "p", "y"])
        w.writeheader()
        w.writerows(filas)
    if ultimo is not None:
        import joblib

        (CARPETA / "modelos").mkdir(exist_ok=True)
        joblib.dump({"modelo": ultimo, "tasa_base": float(y.mean())}, CARPETA / "modelos" / "actual.joblib")
    print(f"{len(filas)} predicciones fuera de muestra en {ruta}")


def _predicciones() -> dict[str, dict[int, tuple[float, int]]]:
    ultimo = sorted(CARPETA.glob("predicciones-*.csv"))
    if not ultimo:
        raise SystemExit("Corre antes `python -m evals.olvido walkforward`.")
    por: dict[str, dict[int, tuple[float, int]]] = {}
    with ultimo[-1].open(encoding="utf-8") as f:
        for r in csv.DictReader(f):
            por.setdefault(r["modelo"], {})[int(r["fila"])] = (float(r["p"]), int(r["y"]))
    return por


def informe() -> None:
    for modelo, filas in _predicciones().items():
        p = [x for x, _ in filas.values()]
        y = [z for _, z in filas.values()]
        mae = sum(abs(a - b) for a, b in zip(p, y, strict=True)) / len(p)
        print(f"{modelo:<20} log-loss {log_loss(p, y):.3f} · Brier {brier(p, y):.3f} · AUC {auc(p, y):.3f} · "
              f"ECE {ece(p, y):.3f} · MAE {mae:.3f} · n {len(p)}")
        for u in (0.7, 0.8, 0.9):
            vp = sum(1 for a, b in zip(p, y, strict=True) if a < u and b == 0)
            fp = sum(1 for a, b in zip(p, y, strict=True) if a < u and b == 1)
            fn = sum(1 for a, b in zip(p, y, strict=True) if a >= u and b == 0)
            print(f"    fallo a umbral {u}: precisión {vp / (vp + fp) if vp + fp else 0:.2f} · recall {vp / (vp + fn) if vp + fn else 0:.2f}")
    print("\nFiabilidad del modelo calibrado (predicho, observado, n):")
    cal = _predicciones().get("logistica_calibrada", {})
    for fila in calibracion([x for x, _ in cal.values()], [z for _, z in cal.values()]):
        print("   ", tuple(round(v, 3) if isinstance(v, float) else v for v in fila))


def escalera() -> None:
    por = _predicciones()

    def ll(p, y):
        p = min(1 - 1e-6, max(1e-6, p))
        return -(y * np.log(p) + (1 - y) * np.log(1 - p))

    for contra in ("leitner", "fsrs"):
        for modelo in por:
            if modelo == contra:
                continue
            comunes = sorted(set(por[modelo]) & set(por[contra]))
            pares = [(ll(*por[contra][i]), ll(*por[modelo][i])) for i in comunes]
            dif, lo, hi = bootstrap_pareado(pares, 2000, 7)
            mejor = "mejor" if hi < 0 else "peor" if lo > 0 else "sin diferencia clara"
            print(f"{modelo:<20} frente a {contra:<8}: Δ log-loss {dif:+.4f} [{lo:+.4f}, {hi:+.4f}] → {mejor}")


def _metricas(p: list[float], y: list[int]) -> dict:
    return {"log_loss": round(log_loss(p, y), 4), "brier": round(brier(p, y), 4), "auc": round(auc(p, y), 4),
            "ece": round(ece(p, y), 4), "n": len(p)}


def calcular_capas(series: list[list[tuple]], fraccion: float = 0.25) -> dict:
    """Las tres capas, entrenadas con los repasos anteriores al corte y medidas con los posteriores (que no han visto).
    `series`: por concepto, (momento, nota, confianza, latencia_ms) en orden, como `personal.series(con_extras=True)`."""
    import torch

    from magister.aprender import personal, red
    from magister.aprender.estado import EstadoConcepto, es_acierto

    momentos = sorted(r[0] for serie in series for r in serie)
    corte = momentos[int(len(momentos) * (1 - fraccion))]
    entreno = [s for s in ([r for r in serie if r[0] < corte] for serie in series) if s]
    ajuste = personal._calcular([[(m, n) for m, n, *_ in s] for s in entreno], None)
    defecto = FSRS()
    ajustado = FSRS(parametros=ajuste["parametros"], etiqueta="eval") if ajuste.get("parametros") else None
    base = ajustado if ajuste.get("hecho") else defecto

    ys: list[int] = []
    p: dict[str, list[float]] = {"fsrs_defecto": [], "fsrs_ajustado": []}
    for serie in series:
        for k in range(1, len(serie)):
            momento, nota = serie[k][0], serie[k][1]
            if momento < corte:
                continue
            e = EstadoConcepto("x", momento, [(m, n) for m, n, *_ in serie[:k]])
            ys.append(int(es_acierto(nota)))
            p["fsrs_defecto"].append(defecto.p_recordar(e, momento))
            if ajustado:
                p["fsrs_ajustado"].append(ajustado.p_recordar(e, momento))
    datos = red.muestras(series, base)
    tr = [d for d in datos if d[0] < corte]
    te = [d for d in datos if d[0] >= corte]
    modelo = red._entrenar([d[1] for d in tr], [d[2] for d in tr])
    with torch.no_grad():
        x = torch.tensor([d[1] for d in te], dtype=torch.float32)
        p["red"] = torch.sigmoid(x[:, 0] + modelo(x).squeeze(-1)).tolist()
    y_red = [int(d[2]) for d in te]
    decision = {k: v for k, v in red.calcular(entreno, base).items() if not k.startswith("_")}
    capas = {"fsrs_defecto": _metricas(p["fsrs_defecto"], ys), "red": _metricas(p["red"], y_red)}
    if ajustado:
        capas["fsrs_ajustado"] = _metricas(p["fsrs_ajustado"], ys)
    elegida = "red" if decision["estado"] == "activa" else "fsrs_ajustado" if ajuste.get("hecho") else "fsrs_defecto"
    p_e, y_e = (p["red"], y_red) if elegida == "red" else (p[elegida], ys)
    return {"corte": corte.isoformat(timespec="minutes"), "repasos_entreno": len(tr), "repasos_prueba": len(ys),
            "ajuste": {k: ajuste.get(k) for k in ("hecho", "etapa", "conceptos", "perdida_antes", "perdida_despues", "motivo")},
            "red": decision, "capas": capas, "elegida": elegida, "calibracion_elegida": calibracion(p_e, y_e, 5)}


def comprobar_capas(r: dict, tolerancia: float = 0.01) -> list[str]:
    """Lo que no debe pasar: pérdidas no finitas, o que la capa que manda prediga peor que FSRS por defecto."""
    problemas = [f"{k}: pérdida no finita" for k, m in r["capas"].items() if not np.isfinite(m["log_loss"])]
    base = r["capas"]["fsrs_defecto"]["log_loss"]
    elegida = r["capas"][r["elegida"]]["log_loss"]
    if elegida > base + tolerancia:
        problemas.append(f"manda {r['elegida']} con log-loss {elegida:.4f}, peor que FSRS por defecto ({base:.4f})")
    return problemas


async def capas(simulado: bool) -> None:
    from magister.aprender import personal
    from magister.config import ajustes
    from magister.datos import sesion

    if simulado:
        sesion.configurar(ajustes.db_url_sim)
    series = await personal.series(con_extras=True)
    await sesion.cerrar()
    if sum(len(s) for s in series) < 200:
        raise SystemExit("Pocos repasos para medir las capas. Con --simulado, corre antes `python -m magister.aprender.simular`.")
    r = calcular_capas(series)
    print(f"Corte {r['corte']}: {r['repasos_entreno']} repasos para entrenar, {r['repasos_prueba']} para medir")
    print("Ajuste personal:", r["ajuste"])
    print("Red (su propia validación):", r["red"])
    for nombre, m in r["capas"].items():
        print(f"{nombre:<14} log-loss {m['log_loss']:.4f} · Brier {m['brier']:.4f} · AUC {m['auc']:.4f} · ECE {m['ece']:.4f} · n {m['n']}")
    print(f"Manda: {r['elegida']}. Calibración (predicho, observado, n):")
    for fila in r["calibracion_elegida"]:
        print("   ", tuple(round(v, 3) if isinstance(v, float) else v for v in fila))
    problemas = comprobar_capas(r)
    for x in problemas:
        print("MAL:", x)
    if problemas:
        raise SystemExit(1)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("orden", choices=["primera", "diagnostico", "walkforward", "informe", "escalera", "capas"])
    ap.add_argument("--simulado", action="store_true")
    ap.add_argument("--calibrar", action="store_true")
    a = ap.parse_args()
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    if a.orden == "primera":
        asyncio.run(primera(a.simulado))
    elif a.orden == "diagnostico":
        asyncio.run(diagnostico(a.simulado))
    elif a.orden == "walkforward":
        asyncio.run(walkforward(a.simulado, a.calibrar))
    elif a.orden == "informe":
        informe()
    elif a.orden == "capas":
        asyncio.run(capas(a.simulado))
    else:
        escalera()


if __name__ == "__main__":
    main()
