"""Red neuronal de olvido: corrige a tu FSRS con lo que FSRS no ve.

FSRS solo mira las notas y el tiempo. La red añade tu seguridad al responder, lo que tardas, la hora, tu racha, si te
pasaste de seguro la última vez y tu acierto reciente, y aprende una corrección sobre la predicción de FSRS:

    p = sigmoide(logit(p_FSRS) + red(características))

La última capa empieza a cero: recién creada, la red ES tu FSRS. Se entrena una vez al día con tus repasos y se
evalúa con los más recientes, que no ha visto (corte temporal). Solo manda si predice mejor que FSRS en esos;
si no, se queda «en sombra» (entrenada, medida, sin decidir). Con pocos datos, ni se entrena.
El entrenamiento y la carga van en un hilo: son CPU y no deben bloquear la API.
"""

import asyncio
import hashlib
import math
from datetime import datetime, timezone
from pathlib import Path

from magister.aprender.estado import EstadoConcepto, es_acierto
from magister.config import ajustes

CLAVE = "red_olvido"
MIN_ENTRENAR = 120  # repasos que se pueden predecir (del segundo en adelante)
MIN_VALIDAR = 40
MEJORA_MINIMA = 0.01  # 1 % menos de pérdida logarítmica que FSRS en lo no visto
NOTAS = ("fallo", "parcial", "bien", "perfecta")
N_CARACTERISTICAS = 18

_red = None  # el módulo de torch cargado
_meta: dict | None = None


def ruta_modelo() -> Path:
    carpeta = Path(ajustes.salidas) / "modelos"
    carpeta.mkdir(parents=True, exist_ok=True)
    return carpeta / "red-olvido.pt"


def _logit(p: float) -> float:
    p = min(max(p, 1e-4), 1 - 1e-4)
    return math.log(p / (1 - p))


def caracteristicas(base, e: EstadoConcepto, ahora: datetime, tasa: float) -> list[float]:
    """Lo que sabe la red de un concepto en un momento (con su historial hasta ahí)."""
    c = base.tarjeta(e)
    p = base.p_recordar(e, ahora) if e.repasos else 0.5
    dias = (ahora - e.repasos[-1][0]).total_seconds() / 86400 if e.repasos else 0.0
    n = len(e.repasos)
    ultima = e.repasos[-1][1] if e.repasos else None
    extra = e.extras[-1] if e.extras else {}
    conf = extra.get("confianza")
    lat = extra.get("latencia_ms")
    racha = 0
    for _, nota in reversed(e.repasos):
        if not es_acierto(nota):
            break
        racha += 1
    hora = ahora.hour + ahora.minute / 60
    return [
        _logit(p),
        math.log1p(max(dias, 0.0)),
        math.log(max(c.stability or 1.0, 1e-3)),
        (c.difficulty or 5.0) / 10,
        math.log1p(n),
        (e.fallos / n) if n else 0.0,
        *[1.0 if ultima == x else 0.0 for x in NOTAS],
        conf if conf is not None else 0.5,
        1.0 if conf is not None else 0.0,
        1.0 if (conf is not None and conf >= 0.75 and ultima is not None and not es_acierto(ultima)) else 0.0,
        math.log1p(lat / 1000) / 5 if lat else 0.0,
        math.sin(2 * math.pi * hora / 24),
        math.cos(2 * math.pi * hora / 24),
        tasa,
        min(racha, 5) / 5,
    ]


def _crear():
    import torch
    from torch import nn

    red = nn.Sequential(nn.Linear(N_CARACTERISTICAS, 32), nn.GELU(), nn.Linear(32, 16), nn.GELU(), nn.Linear(16, 1))
    with torch.no_grad():
        red[-1].weight.zero_()
        red[-1].bias.zero_()
    return red


def muestras(series: list[list[tuple]], base) -> list[tuple[datetime, list[float], float]]:
    """De tus series de repasos (momento, nota, confianza, latencia), un ejemplo por repaso desde el segundo:
    las características justo antes y si acertaste. La tasa de acierto reciente se calcula en el orden real."""
    eventos = sorted(((m, i, k) for i, serie in enumerate(series) for k, (m, *_r) in enumerate(serie)), key=lambda x: x[0])
    ultimos: list[float] = []
    salida = []
    for momento, i, k in eventos:
        serie = series[i]
        nota = serie[k][1]
        if k > 0:
            previos = serie[:k]
            e = EstadoConcepto("x", momento, [(m_, n_) for m_, n_, *_r in previos],
                               [{"confianza": c_, "latencia_ms": l_} for _m, _n, c_, l_ in previos])
            tasa = sum(ultimos[-20:]) / len(ultimos[-20:]) if ultimos else 0.7
            salida.append((momento, caracteristicas(base, e, momento, tasa), 1.0 if es_acierto(nota) else 0.0))
        ultimos.append(1.0 if es_acierto(nota) else 0.0)
    return salida


def _perdida_fsrs(xs: list[list[float]], ys: list[float]) -> float:
    tot = 0.0
    for x, y in zip(xs, ys):
        p = 1 / (1 + math.exp(-x[0]))
        p = min(max(p, 1e-4), 1 - 1e-4)
        tot -= y * math.log(p) + (1 - y) * math.log(1 - p)
    return tot / len(ys)


def _entrenar(xs: list[list[float]], ys: list[float], epocas: int = 400):
    import torch

    torch.manual_seed(0)
    red = _crear()
    x = torch.tensor(xs, dtype=torch.float32)
    y = torch.tensor(ys, dtype=torch.float32)
    opt = torch.optim.Adam(red.parameters(), lr=1e-2, weight_decay=1e-3)
    bce = torch.nn.BCEWithLogitsLoss()
    for _ in range(epocas):
        opt.zero_grad()
        resto = red(x).squeeze(-1)
        perdida = bce(x[:, 0] + resto, y) + 0.01 * (resto**2).mean()  # cerca de FSRS salvo que los datos digan otra cosa
        perdida.backward()
        opt.step()
    red.eval()
    return red


def _perdida_red(red, xs, ys) -> float:
    import torch

    with torch.no_grad():
        x = torch.tensor(xs, dtype=torch.float32)
        logit = x[:, 0] + red(x).squeeze(-1)
        return float(torch.nn.functional.binary_cross_entropy_with_logits(logit, torch.tensor(ys, dtype=torch.float32)))


def calcular(series: list[list[tuple]], base) -> dict:
    """Entrena y decide. Puro salvo por torch: se puede probar con datos inventados."""
    datos = muestras(series, base)
    if len(datos) < MIN_ENTRENAR + MIN_VALIDAR:
        return {"estado": "sin_datos", "repasos": len(datos), "faltan": MIN_ENTRENAR + MIN_VALIDAR - len(datos)}
    corte = max(MIN_VALIDAR, len(datos) // 4)
    entreno, prueba = datos[:-corte], datos[-corte:]
    red = _entrenar([d[1] for d in entreno], [d[2] for d in entreno])
    xs_p, ys_p = [d[1] for d in prueba], [d[2] for d in prueba]
    fsrs, propia = _perdida_fsrs(xs_p, ys_p), _perdida_red(red, xs_p, ys_p)
    gana = propia < fsrs * (1 - MEJORA_MINIMA)
    if gana:  # validada: se reentrena con todo lo que hay
        red = _entrenar([d[1] for d in datos], [d[2] for d in datos])
    ultimos = [d[2] for d in datos[-20:]]
    return {"estado": "activa" if gana else "sombra", "repasos": len(datos), "validacion": len(prueba),
            "perdida_fsrs": round(fsrs, 4), "perdida_red": round(propia, 4),
            "tasa": sum(ultimos) / len(ultimos), "_red": red}


# ---- Uso: el programador ----

class ProgramadorRed:
    def __init__(self, base, red, meta: dict) -> None:
        self.base = base
        self.red = red
        self.tasa = meta.get("tasa", 0.7)
        self.version = f"{base.version}+red-{meta.get('huella', '')}"
        self.retencion = base.retencion

    def tarjeta(self, estado):
        return self.base.tarjeta(estado)

    def _p(self, estado, momentos: list[datetime]) -> list[float]:
        import torch

        xs = [caracteristicas(self.base, EstadoConcepto(estado.concepto_id, t, estado.repasos, estado.extras), t, self.tasa) for t in momentos]
        with torch.no_grad():
            x = torch.tensor(xs, dtype=torch.float32)
            return torch.sigmoid(x[:, 0] + self.red(x).squeeze(-1)).tolist()

    def p_recordar(self, estado, ahora):
        if not estado.repasos:
            return 0.5
        return float(self._p(estado, [ahora])[0])

    def proxima(self, estado):
        if not estado.repasos:
            return None
        from datetime import timedelta

        tope = self.base.proxima(estado)  # FSRS con sus topes de lo recién aprendido: nunca más tarde que eso
        ultimo = estado.repasos[-1][0]
        pasos = [ultimo + timedelta(days=0.25 * (1.15**k)) for k in range(60) if 0.25 * (1.15**k) <= 400]
        ps = self._p(estado, pasos)
        for t, p in zip(pasos, ps):
            if p < self.retencion:
                return min(t, tope) if tope else t
        return tope or pasos[-1]

    def siguiente(self, estado, nota, ahora):
        from magister.aprender.programador import _con

        nuevo = _con(estado, nota, ahora)
        return nuevo, self.proxima(nuevo)


def envolver(base):
    """La red solo manda si está activa (validada); si no, tu FSRS tal cual."""
    if _red is not None and _meta and _meta.get("estado") == "activa":
        return ProgramadorRed(base, _red, _meta)
    return base


def meta() -> dict | None:
    return _meta


async def cargar() -> None:
    global _red, _meta
    from magister.datos.produccion import Ajuste
    from magister.datos.sesion import nueva_sesion

    async with nueva_sesion() as s:
        fila = await s.get(Ajuste, CLAVE)
    _meta = (fila.valor if fila else None) or None
    if _meta and _meta.get("estado") == "activa" and ruta_modelo().exists():
        def leer():
            import torch

            red = _crear()
            red.load_state_dict(torch.load(ruta_modelo(), weights_only=True))
            red.eval()
            return red

        _red = await asyncio.to_thread(leer)


async def entrenar() -> dict:
    """Entrena con tus repasos, decide si manda y lo guarda."""
    global _red, _meta
    from sqlalchemy.dialects.postgresql import insert

    from magister.aprender import personal, programador as prog
    from magister.aprender.programador import FSRS
    from magister.datos.produccion import Ajuste
    from magister.datos.sesion import nueva_sesion

    series = await personal.series(con_extras=True)
    pp = personal.parametros_guardados()
    base = FSRS(parametros=pp["parametros"]) if pp else FSRS()
    r = await asyncio.to_thread(calcular, series, base)
    red = r.pop("_red", None)
    valor = {**r, "fecha": datetime.now(timezone.utc).isoformat(timespec="minutes")}
    if red is not None:
        def guardar():
            import torch

            torch.save(red.state_dict(), ruta_modelo())
            return hashlib.sha256(ruta_modelo().read_bytes()).hexdigest()[:8]

        valor["huella"] = await asyncio.to_thread(guardar)
    async with nueva_sesion() as s, s.begin():
        await s.execute(insert(Ajuste).values(clave=CLAVE, valor=valor)
                        .on_conflict_do_update(index_elements=[Ajuste.clave], set_={"valor": valor}))
    _meta = valor
    _red = red if valor.get("estado") == "activa" else None
    prog.programador.cache_clear()
    return valor
