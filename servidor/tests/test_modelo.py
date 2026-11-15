import pytest

from magister.cerebro.modelo import ErrorModelo, Turno, componer_entrada, generar

pytestmark = pytest.mark.anyio


async def test_eco_concatena_exacto() -> None:
    trozos = [t async for t in generar("x", [Turno("usuario", "hola tutor")])]
    assert "".join(trozos) == "Eco: hola tutor "
    assert len(trozos) == 3


def test_entrada_con_conversacion_previa() -> None:
    e = componer_entrada([Turno("usuario", "a"), Turno("tutor", "b"), Turno("usuario", "c")])
    assert e.startswith("<conversacion_previa>\nAlumno: a\n\nTutor: b\n</conversacion_previa>")
    assert e.endswith("c")


def test_historial_vacio() -> None:
    with pytest.raises(ErrorModelo):
        componer_entrada([])
