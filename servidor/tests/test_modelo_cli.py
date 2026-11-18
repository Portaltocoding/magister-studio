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
