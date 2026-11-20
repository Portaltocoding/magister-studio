"""Los textos del servidor que llegan al alumno siguen su idioma (las preferencias del tutor). Sin base ni red."""

from datetime import date

import pytest

from magister.api.rutas_tutor import razon_de_hoy
from magister.flujo import comun
from magister.fuentes import ingesta


def test_la_razon_de_hoy_sale_en_su_idioma() -> None:
    hoy = date(2026, 11, 20)
    assert razon_de_hoy(hoy, hoy) == "Toca hoy según tu calendario."
    assert razon_de_hoy(hoy, hoy, en=True) == "It is due today according to your calendar."
    assert razon_de_hoy(date(2026, 11, 18), hoy, en=True).startswith("You are behind")
    assert razon_de_hoy(date(2026, 11, 25), hoy, en=True) == "Next on your calendar is 25-11."
    assert razon_de_hoy(date(2026, 11, 25), hoy) == "Lo siguiente de tu calendario es el 25-11."


def test_los_modos_de_serie_se_nombran_en_ingles_sin_tocar_sus_reglas() -> None:
    en = comun.modos_de_serie("en")
    assert [m["id"] for m in en] == [m["id"] for m in comun.MODOS_DE_SERIE]
    assert en[0]["nombre"] == "Socratic" and "questions" in en[0]["para"]
    assert [m["reglas"] for m in en] == [m["reglas"] for m in comun.MODOS_DE_SERIE]  # las reglas son del prompt
    assert comun.modos_de_serie("es") is comun.MODOS_DE_SERIE
    assert all(m["id"] in comun.MODOS_EN for m in comun.MODOS_DE_SERIE)


def test_que_paso_con_un_documento_sale_en_ingles() -> None:
    es, _ = ingesta.explicar_problema("cuarentena", "no se pudo extraer: roto", False, 0)
    en, destino = ingesta.explicar_problema("cuarentena", "no se pudo extraer: roto", False, 0, idioma="en")
    assert es == "No se pudo sacar el texto (el fichero puede estar dañado)."
    assert en == "The text could not be extracted (the file may be damaged)." and destino == "recibida"
    vacio, _ = ingesta.explicar_problema("cuarentena", "el fichero está vacío", True, 0, idioma="en")
    assert vacio.startswith("The file is empty")
    sin_problema = ingesta.explicar_problema("lista", None, True, 5, idioma="en")
    assert sin_problema == ("", None)
    # Todo lo que sale en español tiene su versión en inglés.
    for claro in ("Está guardado", "Casi no tiene texto: la página", "Parece un PDF escaneado"):
        assert any(k.startswith(claro) for k in ingesta._EN)


@pytest.mark.anyio
async def test_las_frases_de_la_espera_piden_el_idioma_del_alumno(monkeypatch) -> None:
    pedidos: list[str] = []

    async def estructurar(sistema, pregunta, modelo, **_):
        pedidos.append(sistema)
        return comun.Adelanto(guion="Here is the plan:\n1. A", frases=["Overthinking a bit…", "Checking twice…", "Nodding wisely…"])

    async def preferencias() -> dict:
        return {"idioma": "en"}

    escritos: list[dict] = []
    monkeypatch.setattr(comun, "estructurar", estructurar)
    monkeypatch.setattr(comun, "preferencias_tutor", preferencias)
    monkeypatch.setattr(comun, "escribir", lambda **d: escritos.append(d))
    espera = comun._Espera([comun.Turno(rol="usuario", contenido="why is the sky blue?")])
    await espera._adelantar()
    assert comun.IDIOMA_INGLES_PLAN in pedidos[0]
    assert escritos[0]["adelanto"]["frases"][0] == "Overthinking a bit…"

    pedidos.clear()

    async def en_espanol() -> dict:
        return {"idioma": "es"}

    monkeypatch.setattr(comun, "preferencias_tutor", en_espanol)
    await comun._Espera([comun.Turno(rol="usuario", contenido="¿por qué?")])._adelantar()
    assert comun.IDIOMA_INGLES_PLAN not in pedidos[0]


@pytest.mark.anyio
async def test_el_idioma_del_alumno_si_no_se_pueden_leer_las_preferencias_es_el_espanol(monkeypatch) -> None:
    async def roto() -> dict:
        raise RuntimeError("sin base")

    monkeypatch.setattr(comun, "preferencias_tutor", roto)
    assert await comun.idioma_del_alumno() == "es"
