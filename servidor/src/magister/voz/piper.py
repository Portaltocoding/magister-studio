"""Voz neuronal local con Piper: suena mucho más natural que las voces de Windows y no sale del equipo.

Un proceso de Piper por voz, abierto la primera vez y reutilizado (cargar el modelo cuesta más que decir una frase):
recibe una línea JSON por frase y escribe un WAV; se leen de uno en uno, en orden. Lo ya dicho se guarda en memoria,
porque la clase repite frases al retomar tras una interrupción.
"""

import asyncio
import json
import tempfile
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path

from magister.config import ajustes


class VozNoDisponible(Exception):
    pass


@dataclass(frozen=True)
class Voz:
    id: str
    nombre: str
    modelo: str  # fichero .onnx dentro de MAGISTER_VOZ_DIR
    hablante: int | None = None


VOCES = [
    Voz("sharvard-f", "Sharvard (mujer)", "es_ES-sharvard-medium.onnx", 1),
    Voz("sharvard-m", "Sharvard (hombre)", "es_ES-sharvard-medium.onnx", 0),
    Voz("davefx", "Davefx (hombre)", "es_ES-davefx-medium.onnx"),
]
MAX_CACHE = 300
MAX_TEXTO = 600


def disponibles() -> list[Voz]:
    exe = Path(ajustes.voz_piper)
    if not exe.is_file():
        return []
    return [v for v in VOCES if (Path(ajustes.voz_dir) / v.modelo).is_file()]


class _Proceso:
    def __init__(self, modelo: Path):
        self.modelo = modelo
        self.proc: asyncio.subprocess.Process | None = None
        self.candado = asyncio.Lock()
        self.carpeta = Path(tempfile.mkdtemp(prefix="magister-voz-"))
        self.n = 0

    async def _arrancar(self) -> asyncio.subprocess.Process:
        if self.proc is None or self.proc.returncode is not None:
            self.proc = await asyncio.create_subprocess_exec(
                ajustes.voz_piper, "--model", str(self.modelo), "--json-input", "--output_dir", str(self.carpeta), "-q",
                stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
            )
        return self.proc

    async def decir(self, texto: str, hablante: int | None) -> bytes:
        async with self.candado:
            for intento in range(2):
                proc = await self._arrancar()
                self.n += 1
                destino = self.carpeta / f"{self.n}.wav"
                linea = {"text": texto, "output_file": str(destino)}
                if hablante is not None:
                    linea["speaker_id"] = hablante
                try:
                    assert proc.stdin and proc.stdout
                    proc.stdin.write((json.dumps(linea, ensure_ascii=False) + "\n").encode("utf-8"))
                    await proc.stdin.drain()
                    # Piper escribe en stdout la ruta del WAV cuando lo termina.
                    await asyncio.wait_for(proc.stdout.readline(), timeout=30)
                    datos = await asyncio.to_thread(destino.read_bytes)
                    await asyncio.to_thread(destino.unlink, True)
                    return datos
                except (OSError, TimeoutError, AssertionError):
                    if proc.returncode is None:
                        proc.kill()
                    self.proc = None
                    if intento == 1:
                        raise VozNoDisponible("Piper no ha podido decir la frase") from None
        raise VozNoDisponible("Piper no responde")


_procesos: dict[str, _Proceso] = {}
_cache: OrderedDict[tuple[str, str], bytes] = OrderedDict()


async def sintetizar(texto: str, voz_id: str) -> bytes:
    """El WAV de una frase con esa voz."""
    texto = " ".join(texto.split())[:MAX_TEXTO]
    if not texto:
        raise ValueError("no hay nada que decir")
    voz = next((v for v in disponibles() if v.id == voz_id), None)
    if voz is None:
        raise VozNoDisponible(f"la voz {voz_id} no está instalada")
    clave = (voz.id, texto)
    if clave in _cache:
        _cache.move_to_end(clave)
        return _cache[clave]
    p = _procesos.get(voz.modelo)
    if p is None:
        p = _procesos[voz.modelo] = _Proceso(Path(ajustes.voz_dir) / voz.modelo)
    datos = await p.decir(texto, voz.hablante)
    _cache[clave] = datos
    while len(_cache) > MAX_CACHE:
        _cache.popitem(last=False)
    return datos


async def cerrar() -> None:
    for p in _procesos.values():
        if p.proc and p.proc.returncode is None:
            p.proc.kill()
    _procesos.clear()
