"""Cómo se lanza claude -p (sin lanzarlo): un prompt de sistema largo va por fichero, que se borra al acabar."""

from pathlib import Path

import pytest

from magister.cerebro import modelo


@pytest.mark.anyio
async def test_un_sistema_largo_va_por_fichero_y_se_borra(monkeypatch) -> None:
    monkeypatch.setattr(modelo.shutil, "which", lambda _: "claude")
    vistos: list[list[str]] = []

    async def proceso_falso(args, entrada):
        vistos.append(args)
        if "--system-prompt-file" in args:
            fichero = Path(args[args.index("--system-prompt-file") + 1])
            assert fichero.read_text(encoding="utf-8") == largo
        yield {"type": "result"}

    monkeypatch.setattr(modelo, "_proceso_claude", proceso_falso)
    largo = "á" * (modelo.SISTEMA_EN_FICHERO + 1)
    assert [e async for e in modelo._lanzar_claude(largo, "hola")] == [{"type": "result"}]
    assert [e async for e in modelo._lanzar_claude("corto", "hola")] == [{"type": "result"}]
    largos, cortos = vistos
    assert largo not in largos and "--system-prompt" not in largos
    assert not Path(largos[largos.index("--system-prompt-file") + 1]).exists()
    assert cortos[cortos.index("--system-prompt") + 1] == "corto" and "--system-prompt-file" not in cortos


def _falso(pausas: list[float]) -> list[str]:
    """Un «claude» de mentira: una línea JSON tras cada pausa y el resultado al final."""
    import sys

    codigo = ("import json,sys,time\n"
              f"for p in {pausas!r}:\n"
              "    time.sleep(p); print(json.dumps({'type': 'stream_event'}), flush=True)\n"
              "print(json.dumps({'type': 'result'}), flush=True)\n")
    return [sys.executable, "-c", codigo]


@pytest.mark.anyio
async def test_el_plazo_cuenta_sin_noticias_con_un_tope(monkeypatch) -> None:
    monkeypatch.setattr(modelo.ajustes, "timeout_s", 0.6)
    # Habla cada 0,25 s durante 1,25 s (más que el plazo): no se corta.
    eventos = [e async for e in modelo._proceso_claude(_falso([0.25] * 5), "")]
    assert eventos[-1]["type"] == "result"
    # Callado más que el plazo: se corta.
    with pytest.raises(modelo.ErrorModelo, match="plazo agotado"):
        [e async for e in modelo._proceso_claude(_falso([1.2]), "")]
    # Habla sin parar más allá del tope (3 × 0,6 s): se corta igual.
    with pytest.raises(modelo.ErrorModelo, match="plazo agotado"):
        [e async for e in modelo._proceso_claude(_falso([0.2] * 15), "")]


def _con_nieto() -> list[str]:
    """Un «claude» que lanza un hijo suyo, dice los dos pid y se queda razonando (callado) un minuto."""
    import sys

    codigo = ("import json,subprocess,sys,time\n"
              "nieto = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])\n"
              "print(json.dumps({'type': 'stream_event', 'pids': [__import__('os').getpid(), nieto.pid]}), flush=True)\n"
              "time.sleep(60)\n")
    return [sys.executable, "-c", codigo]


async def _vivo(pid: int) -> bool:
    import asyncio
    import os
    import sys

    if sys.platform != "win32":
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return False
        return True
    p = await asyncio.create_subprocess_exec("tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH",
                                             stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
    salida, _ = await p.communicate()
    return f'"{pid}"' in salida.decode("utf-8", "replace")


@pytest.mark.anyio
async def test_si_te_vas_a_medias_claude_muere_con_lo_que_haya_lanzado() -> None:
    """Como al cerrar la pestaña o pulsar Parar: la petición se cancela mientras claude razona. Con un cancel scope de
    anyio, el de la respuesta SSE, que vuelve a cancelar en cada await: matar va blindado."""
    import sys

    import anyio

    pids: list[int] = []
    with anyio.CancelScope() as alcance:
        async for evento in modelo._proceso_claude(_con_nieto(), ""):
            pids = evento["pids"]
            alcance.cancel()
    assert alcance.cancelled_caught and len(pids) == 2
    hijo, nieto = pids
    assert not await _vivo(hijo)
    if sys.platform == "win32":  # kill() solo llega al hijo; taskkill /T, al árbol entero
        for _ in range(20):
            if not await _vivo(nieto):
                break
            await anyio.sleep(0.1)
        assert not await _vivo(nieto)
