"""`estructurar`: la única puerta por la que entra salida estructurada.

Valida con Pydantic y con las reglas del llamador; si falla, reintenta con los
errores al final de la entrada. Al agotar, lanza `ErrorEstructura` con los intentos.
"""

import json
import logging
import time
from collections import defaultdict, deque
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import TypeVar

from pydantic import BaseModel, ValidationError

from magister.cerebro.modelo import ErrorModelo, _lineas_claude
from magister.config import RAIZ_SERVIDOR, ajustes

T = TypeVar("T", bound=BaseModel)
registro = logging.getLogger("magister.estructura")

FIJOS = RAIZ_SERVIDOR / "tests" / "fijos"


@dataclass
class Intento:
    errores: list[str]
    salida: dict | None = None


@dataclass
class ErrorEstructura(Exception):
    modelo: str
    intentos: list[Intento] = field(default_factory=list)

    def __str__(self) -> str:
        ultimo = self.intentos[-1].errores if self.intentos else []
        return f"{self.modelo}: {len(self.intentos)} intentos sin salida válida; último: {'; '.join(ultimo)}"

    @property
    def ultima_salida(self) -> dict | None:
        return self.intentos[-1].salida if self.intentos else None


class _Eco:
    """Motor falso: saca el siguiente fijo de la cola de la clase o `tests/fijos/<Clase>.json`."""

    def __init__(self) -> None:
        self.colas: dict[str, deque] = defaultdict(deque)
        self.carpeta: Path = FIJOS

    def encolar(self, modelo: type[BaseModel], fijos: list[str | dict]) -> None:
        self.colas[modelo.__name__].extend(fijos)

    def vaciar(self) -> None:
        self.colas.clear()

    def siguiente(self, modelo: type[BaseModel]) -> dict:
        cola = self.colas[modelo.__name__]
        elegido = cola.popleft() if cola else f"{modelo.__name__}.json"
        if isinstance(elegido, dict):
            return elegido
        return json.loads((self.carpeta / elegido).read_text(encoding="utf-8"))


eco = _Eco()


def _limpiar(e: ValidationError) -> list[str]:
    return [f"{'.'.join(str(x) for x in err['loc'])}: {err['msg']}" for err in e.errors(include_url=False)]


async def _llamar_cli(sistema: str, entrada: str, esquema: dict) -> tuple[dict | None, dict]:
    resultado: dict = {}
    async for evento in _lineas_claude(sistema, entrada, esquema):
        if evento.get("type") == "result":
            resultado = evento
    return resultado.get("structured_output"), resultado


async def estructurar(
    sistema: str,
    entrada: str,
    Modelo: type[T],
    reglas: Callable[[T], list[str]] | None = None,
    reintentos: int | None = None,
    intentos: list[Intento] | None = None,
) -> T:
    """`intentos`, si se pasa, recibe los intentos fallidos (para contar y registrar)."""
    maximo = (ajustes.reintentos if reintentos is None else reintentos) + 1
    intentos = [] if intentos is None else intentos
    esquema = Modelo.model_json_schema()
    for n in range(1, maximo + 1):
        t0 = time.perf_counter()
        texto = entrada
        if intentos:
            previos = "\n".join(f"- {e}" for e in intentos[-1].errores)
            texto += (
                f"\n\n<errores_anteriores>\nTu respuesta anterior no valía por esto; corrígelo:\n{previos}\n"
                "</errores_anteriores>"
            )
        salida: dict | None
        info: dict = {}
        if ajustes.motor == "eco":
            try:
                salida = eco.siguiente(Modelo)
            except FileNotFoundError:
                intentos.append(Intento([f"el motor eco no tiene fijo para {Modelo.__name__}"]))
                continue
        else:
            try:
                salida, info = await _llamar_cli(sistema, texto, esquema)
            except ErrorModelo as e:
                intentos.append(Intento([f"error del modelo: {e}"]))
                continue
        uso = info.get("usage", {})
        registro.info(
            "estructurar %s intento %d modelo=%s in=%s out=%s cache_w=%s cache_r=%s %.1fs",
            Modelo.__name__,
            n,
            next(iter(info.get("modelUsage", {}) or {}), ajustes.modelo),
            uso.get("input_tokens"),
            uso.get("output_tokens"),
            uso.get("cache_creation_input_tokens"),
            uso.get("cache_read_input_tokens"),
            time.perf_counter() - t0,
        )
        if salida is None:
            intentos.append(Intento(["no devolvió salida estructurada"]))
            continue
        try:
            objeto = Modelo.model_validate(salida)
        except ValidationError as e:
            intentos.append(Intento(_limpiar(e), salida))
            continue
        errores = reglas(objeto) if reglas else []
        if errores:
            intentos.append(Intento(errores, salida))
            continue
        return objeto
    raise ErrorEstructura(Modelo.__name__, intentos)
