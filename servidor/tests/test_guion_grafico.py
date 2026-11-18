"""El vídeo animado: el guion gráfico que escribe el modelo, sus reglas, lo que monta el código y su ruta (sin modelo)."""

import copy
import json
import re
from pathlib import Path

import pytest

from magister.material import guion_grafico as gg
from magister.material.guion import auditar_guion

FIJO = Path(__file__).parent / "fijos" / "GuionGraficoModelo.json"
TIPOS_TS = Path(__file__).resolve().parents[2] / "web" / "src" / "escena" / "tipos.ts"


def _fijo() -> dict:
    return json.loads(FIJO.read_text(encoding="utf-8"))


def _modelo(d: dict | None = None) -> gg.GuionGraficoModelo:
    return gg.GuionGraficoModelo.model_validate(d or _fijo())


def test_el_fijo_cumple_las_reglas() -> None:
    assert gg.reglas(_modelo(), 150) == []


def test_reglas_de_lo_que_el_esquema_no_ve() -> None:
    d = _fijo()
    d["tramos"][0]["escena"]["actual"] = 7
    d["tramos"][1]["escena"]["elementos"][3]["a"] = "C"
    d["tramos"][2]["narracion"] = "Es $x = y$."
    errores = "\n".join(gg.reglas(_modelo(d), 150))
    assert "actual 7 fuera del mapa" in errores and "«C» no es ningún punto" in errores and "di las fórmulas con palabras" in errores
    # Primero, el mapa; y el presupuesto de palabras.
    d = _fijo()
    d["tramos"].insert(0, d["tramos"].pop(1))
    assert any("el primer tramo es el mapa" in e for e in gg.reglas(_modelo(d), 150))
    assert any("presupuesto" in e for e in gg.reglas(_modelo(), 1500))


def test_montar_pone_el_mapa_en_cada_tablero_y_quita_lo_vacio() -> None:
    g = gg.montar(_modelo())
    tablero = g["tramos"][0]["escena"]
    assert tablero["partes"][1]["ideas"][0]["nombre"] == "Problema directo" and tablero["actual"] == 0
    punto = g["tramos"][1]["escena"]["elementos"][0]
    assert "coords" not in punto and "estado" not in punto  # null no viaja: la web espera «undefined»
    assert g["fondo"] == "cartesiano" and g["tramos"][3]["escena"]["filas"][0]["resultado"] == "1121{,}353"


def test_por_escenas_sirve_al_reproductor_de_siempre() -> None:
    texto = gg.por_escenas(gg.montar(_modelo()))
    assert texto.startswith("[[mapa]]\nEsta lección") and "[[choque]]\nSi sumas" in texto
    assert [h.regla for h in auditar_guion(texto, 1)] == []


def test_las_escenas_existen_en_la_web() -> None:
    """Cada escena que puede escribir el modelo la sabe pintar el motor (tipos.ts)."""
    en_web = set(re.findall(r"tipo: '([a-z_]+)'", TIPOS_TS.read_text(encoding="utf-8")))
    del_modelo = {m.model_fields["tipo"].annotation.__args__[0] for m in gg.Escena.__args__}
    elementos = {m.model_fields["tipo"].annotation.__args__[0]
                 for m in (gg.Punto, gg.Segmento, gg.Angulo, gg.Proyeccion, gg.Norte, gg.TextoFigura)}
    assert del_modelo <= en_web and elementos <= en_web


def test_el_esquema_no_usa_oneof() -> None:
    assert "oneOf" not in json.dumps(gg.GuionGraficoModelo.model_json_schema())


@pytest.mark.anyio
async def test_generar_con_eco_y_si_no_sale_none(base) -> None:
    from magister.cerebro.estructura import eco
    from magister.material.modelos import EntradaMaterial

    entrada = EntradaMaterial(plan_id=1, leccion_clave="L1", tema="Topografía", titulo="Coordenadas", objetivos=[], conceptos=[])
    eco.vaciar()
    g = await gg.generar_guion_grafico(entrada, "apuntes", 1, "clase")
    assert g is not None and g["tramos"][0]["escena"]["tipo"] == "tablero"
    malo = _fijo()
    malo["tramos"][0]["escena"]["actual"] = 99
    eco.encolar(gg.GuionGraficoModelo, [copy.deepcopy(malo) for _ in range(10)])
    assert await gg.generar_guion_grafico(entrada, "apuntes", 1, "clase") is None
    eco.vaciar()


@pytest.mark.anyio
async def test_la_ruta_del_guion_grafico(cliente) -> None:
    from magister.config import ajustes
    from magister.material import almacen

    from tests.test_material import plan_aceptado

    plan_id = await plan_aceptado()
    sin = await almacen.nuevo_material(plan_id, "L1", "guion", None)
    con = await almacen.nuevo_material(plan_id, "L1", "guion", None)
    destino = Path(ajustes.salidas) / f"{plan_id}-L1" / f"guion_grafico-{con}.json"
    destino.parent.mkdir(parents=True, exist_ok=True)
    destino.write_text(json.dumps(gg.montar(_modelo()), ensure_ascii=False), encoding="utf-8")
    await almacen.actualizar(con, rutas={"grafico": str(destino)}, estado="listo")
    await almacen.actualizar(sin, estado="listo")
    assert (await cliente.get(f"/api/materiales/{sin}/guion_grafico")).status_code == 404
    r = await cliente.get(f"/api/materiales/{con}/guion_grafico")
    assert r.status_code == 200 and r.json()["titulo"] == "Coordenadas en un minuto"
    animados = {v["material_id"]: v["animado"] for v in (await cliente.get(f"/api/planes/{plan_id}/videos")).json()}
    assert animados == {sin: False, con: True}


@pytest.mark.anyio
async def test_el_perfil_de_materia_entra_en_el_guion_grafico(monkeypatch) -> None:
    from magister.cerebro import materias
    from magister.material.modelos import EntradaMaterial

    vistos: list[str] = []

    async def estructurar_falso(sistema, entrada, Modelo, **_):
        vistos.append(sistema)
        return gg.GuionGraficoModelo.model_validate(_fijo())

    monkeypatch.setattr(gg, "estructurar", estructurar_falso)
    datos = dict(plan_id=1, leccion_clave="L1", tema="Derecho civil", titulo="La usucapión", objetivos=[], conceptos=[])
    await gg.generar_guion_grafico(EntradaMaterial(**datos), "apuntes", 1, "clase")
    await gg.generar_guion_grafico(EntradaMaterial(**datos, materia="derecho"), "apuntes", 1, "clase")
    sin, con = vistos
    assert materias.texto("derecho") not in sin and con.endswith(materias.texto("derecho"))
