"""Dos niveles para cada harness (`corto` y `completo`) y un tope duro de llamadas al modelo por ejecución.

Todo `claude -p` sale de `magister.cerebro.modelo._lanzar_claude` (regla 1 de Producción), y con el motor eco las
respuestas salen de `_eco` (texto) y de `eco.siguiente` (estructurado). `contar(tope)` envuelve esas tres puertas
mientras dura la eval, sin tocar el código de `magister`: cada llamada pide permiso al tope ANTES de salir, y la que
pasaría del tope no se lanza (lanza `TopeAlcanzado`). Una respuesta servida desde la caché de `estructurar` no es una
llamada y no cuenta.

`TopeAlcanzado` hereda de BaseException a propósito: atraviesa los `except Exception` de los harness y del cerebro (un
reintento de `estructurar` no la confunde con un fallo del modelo) y llega hasta el bucle del harness, que la recoge,
informa de lo que lleva hecho y termina.

    ap = argparse.ArgumentParser()
    tope.argumentos(ap, corto=4, completo=30)
    args = ap.parse_args()
    t = tope.de_args(args)
    with tope.contar(t):
        ...                       # dentro, cada caso: `if not t.cabe(n): break` y `except tope.TopeAlcanzado`
    print(t.resumen())
"""

import argparse
import contextlib
from collections.abc import Iterator, Sequence
from dataclasses import dataclass, field

NIVELES = ("corto", "completo")


class TopeAlcanzado(BaseException):
    """La llamada siguiente pasaría del tope: no se lanza."""


@dataclass
class Tope:
    maximo: int
    nivel: str = "corto"
    hechas: int = 0
    cortado: bool = False
    # Qué pidió cada llamada (el prompt en uso o la clase del motor eco), para el informe.
    por_que: list[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        if self.maximo < 0:
            raise ValueError("el tope de llamadas no puede ser negativo")
        if self.nivel not in NIVELES:
            raise ValueError(f"nivel desconocido: {self.nivel} (corto o completo)")

    @property
    def quedan(self) -> int:
        return max(0, self.maximo - self.hechas)

    def cabe(self, n: int) -> bool:
        """Si caben `n` llamadas más. Para no empezar un caso que no se podría acabar."""
        return self.hechas + n <= self.maximo

    def pedir(self, que: str = "") -> None:
        """Una llamada pide permiso. La que pasaría del tope no sale."""
        if self.hechas >= self.maximo:
            self.cortado = True
            raise TopeAlcanzado(f"tope de {self.maximo} llamadas al modelo alcanzado")
        self.hechas += 1
        self.por_que.append(que)

    def resumen(self) -> str:
        texto = f"Llamadas al modelo: {self.hechas} de un tope de {self.maximo} (nivel {self.nivel})"
        if self.cortado:
            texto += ". Se ha cortado al llegar al tope: lo de arriba es parcial"
        return texto + "."


def argumentos(ap: argparse.ArgumentParser, corto: int, completo: int) -> None:
    """--nivel (corto por defecto: barato) y --max-llamadas (por defecto, el tope del nivel)."""
    ap.add_argument("--nivel", choices=NIVELES, default="corto",
                    help=f"corto: pocos casos, como mucho {corto} llamadas; completo: todos, como mucho {completo}")
    ap.add_argument("--max-llamadas", type=int, default=None,
                    help="tope duro de llamadas al modelo en esta ejecución (por defecto, el del nivel)")
    ap.set_defaults(_topes={"corto": corto, "completo": completo})


def de_args(args: argparse.Namespace) -> Tope:
    maximo = args.max_llamadas if args.max_llamadas is not None else args._topes[args.nivel]
    return Tope(maximo, args.nivel)


def del_nivel(casos: Sequence, nivel: str, corto: Sequence[str] | int, clave: str = "id") -> list:
    """Los casos de un nivel. `corto`: los ids que forman el nivel corto (en el orden del banco) o cuántos de los
    primeros. En `completo`, todos."""
    if nivel not in NIVELES:
        raise ValueError(f"nivel desconocido: {nivel}")
    if nivel == "completo":
        return list(casos)
    if isinstance(corto, int):
        return list(casos)[:corto]
    ids = set(corto)
    faltan = ids - {_id(c, clave) for c in casos}
    if faltan:
        raise ValueError(f"el nivel corto nombra casos que no están en el banco: {', '.join(sorted(faltan))}")
    return [c for c in casos if _id(c, clave) in ids]


def _id(caso, clave: str) -> str:
    return caso[clave] if isinstance(caso, dict) else getattr(caso, clave)


async def a_la_vez(tope: Tope | None, esperables) -> list:
    """Como `asyncio.gather`, pero lo que corta el tope queda en None (y el tope, marcado como cortado) en lugar de
    tirar lo demás. Cualquier otro error sale como antes."""
    import asyncio

    resultados = await asyncio.gather(*esperables, return_exceptions=True)
    salida = []
    for r in resultados:
        if isinstance(r, TopeAlcanzado):
            if tope is not None:
                tope.cortado = True
            salida.append(None)
        elif isinstance(r, BaseException):
            raise r
        else:
            salida.append(r)
    return salida


def correr(principal, tope: Tope) -> None:
    """`asyncio.run(principal)` contando las llamadas; si el tope corta, lo dice y termina limpio. Siempre acaba diciendo
    cuántas llamadas ha hecho."""
    import asyncio
    import sys

    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    with contar(tope):
        try:
            asyncio.run(principal)
        except TopeAlcanzado:
            tope.cortado = True
            print("Cortado al llegar al tope de llamadas: lo de arriba es lo que dio tiempo a hacer.")
    print(tope.resumen())


@contextlib.contextmanager
def contar(tope: Tope) -> Iterator[Tope]:
    """Mientras dura, toda llamada al modelo (claude o eco) pide permiso a `tope`. Al salir, todo queda como estaba."""
    from magister.cerebro import estructura, modelo

    lanzar_original = modelo._lanzar_claude
    eco_texto_original = modelo._eco
    eco = estructura.eco

    def que() -> str:
        p = modelo.prompt_actual.get()
        return p[0] if p else (modelo.tarea_actual.get() or "")

    async def lanzar(*a, **k):
        tope.pedir(que())
        async with contextlib.aclosing(lanzar_original(*a, **k)) as lineas:
            async for evento in lineas:
                yield evento

    async def eco_texto(*a, **k):
        tope.pedir(que() or "eco")
        async for t in eco_texto_original(*a, **k):
            yield t

    def eco_siguiente(Modelo):
        tope.pedir(que() or Modelo.__name__)
        return type(eco).siguiente(eco, Modelo)

    modelo._lanzar_claude = lanzar
    modelo._eco = eco_texto
    eco.siguiente = eco_siguiente  # en la instancia: tapa el método de la clase
    try:
        yield tope
    finally:
        modelo._lanzar_claude = lanzar_original
        modelo._eco = eco_texto_original
        with contextlib.suppress(AttributeError):
            del eco.siguiente
