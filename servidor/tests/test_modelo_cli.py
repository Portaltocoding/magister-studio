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
