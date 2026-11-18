"""Los jueces: el prompt de sistema es solo lo fijo (rúbrica y ejemplos) para que se lea de caché.

Sin red ni claude: se interceptan las llamadas a `estructurar`.
"""

import pytest

from magister.cerebro.prompts import cargar
from magister.material import completitud
from magister.tono import juez
from magister.tono.hallazgo import Hallazgo


def _capturar(monkeypatch: pytest.MonkeyPatch, modulo, salida: dict) -> list[tuple[str, str]]:
    llamadas: list[tuple[str, str]] = []

    async def falso(sistema, entrada, Modelo, **kw):
        llamadas.append((sistema, entrada))
        return Modelo.model_validate(salida)

    monkeypatch.setattr(modulo, "estructurar", falso)
    return llamadas


def _juicio(frag: str) -> dict:
    return {"fragmento": frag, "razon": "x", "aprueba": True}


@pytest.mark.anyio
async def test_juez_tono_sistema_identico_entre_bloques(monkeypatch: pytest.MonkeyPatch) -> None:
    llamadas = _capturar(monkeypatch, juez, {d: _juicio("hola") for d in juez.DIMENSIONES})
    sospecha = Hallazgo(bloque="b", cita="simplemente", regla="condescendencia", por_que="x", gravedad="sospecha", origen="lint")
    r1 = await juez.juzgar("hola mundo, bloque uno")
    r2 = await juez.juzgar("hola otra vez, bloque dos distinto", [sospecha])
    assert len(llamadas) == 2
    (s1, e1), (s2, e2) = llamadas
    assert s1 == s2
    assert e1 != e2
    assert "bloque uno" in e1 and "bloque dos" in e2 and "simplemente" in e2
    # nada variable en el sistema
    assert "bloque uno" not in s1 and "bloque dos" not in s1
    assert not isinstance(r1, juez.FalloJuez) or "literal" in r1.motivo


@pytest.mark.anyio
async def test_juez_tono_sistema_lleva_rubrica_y_golden() -> None:
    sistema, etiqueta = juez.sistema_juez()
    assert juez.rubrica()[0] in sistema
    assert juez.golden()[0] in sistema
    assert etiqueta.startswith("juez_tono@")
    assert cargar("juez_tono").huecos == {"rubrica", "golden"}


def test_golden_tono_carga_y_es_suficiente() -> None:
    texto, version = juez.golden()
    assert len(version) == 12
    assert texto.count("## Ejemplo ") >= 12
    for d in ("Razonamiento:", "Economía:", "Trato:"):
        assert texto.count(d) >= 12
    # cada ejemplo trae los dos veredictos, aprueba y suspende
    assert "aprueba" in texto and "suspende" in texto
    # el prefijo tiene que superar el mínimo de la caché de prompts (unos 2048 tokens; ~3,5 caracteres por token en español)
    sistema, _ = juez.sistema_juez()
    assert len(sistema) > 4096 * 3.5


def test_golden_sin_llaves() -> None:
    assert "{" not in juez.golden()[0] and "}" not in juez.golden()[0]
    assert "{" not in completitud.golden() and "}" not in completitud.golden()


@pytest.mark.anyio
async def test_juez_completitud_sistema_identico_entre_conceptos(monkeypatch: pytest.MonkeyPatch) -> None:
    llamadas = _capturar(monkeypatch, completitud,
                               {"cita": "apuntes uno", "razon": "x", "explicado": True})
    await completitud._juzgar("apuntes uno", {"nombre": "Hash map", "sinonimos": ["diccionario"]})
    await completitud._juzgar("apuntes uno y otros", {"nombre": "Cola"})
    (s1, e1), (s2, e2) = llamadas
    assert s1 == s2
    assert "Hash map" in e1 and "diccionario" in e1 and "Cola" in e2
    assert "Hash map" not in s1 and "apuntes uno" not in s1.split("Estos son ejemplos")[0]
    assert completitud.golden() in s1


def test_golden_completitud_carga() -> None:
    texto = completitud.golden()
    assert texto.count("## Ejemplo ") >= 8
    assert texto.count("Explicado: sí") >= 3 and texto.count("Explicado: no") >= 3
