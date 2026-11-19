"""Los apuntes guardados con plantillas de antes se ponen al día solos al servirlos, sin modelo."""

import asyncio

import pytest
from sqlalchemy import func, select, update

from magister.datos.material import Material, Pregunta, Trabajo
from magister.datos.sesion import nueva_sesion
from magister.material import almacen
from magister.material.plantillas import VERSION_MONTAJE
from tests.test_material import plan_aceptado


async def _apuntes(montaje: int | None, texto: str) -> tuple[int, int]:
    plan_id = await plan_aceptado()
    mid = await almacen.nuevo_material(plan_id, "L1", "apuntes", None)
    await almacen.guardar_bloque(mid, "b1", "Claves", "Texto del bloque.", 0, False, "v")
    async with nueva_sesion() as s, s.begin():
        await s.execute(update(Material).where(Material.id == mid).values(
            estado="listo", texto=texto, montaje=montaje, versiones={"apuntes_bloque": "abc123"}))
        s.add(Pregunta(id="p-test", plan_id=plan_id, leccion_clave="L1", tipo="test", enunciado="¿Cuál?",
                       fantasma="La buena.", donde="b1", estado="activa",
                       opciones=[{"texto": "Buena", "buena": True}, {"texto": "Mala", "buena": False},
                                 {"texto": "Peor", "buena": False}]))
    return plan_id, mid


async def _repintados() -> list[Trabajo]:
    async with nueva_sesion() as s:
        return list((await s.scalars(select(Trabajo).where(Trabajo.tipo == "repintar"))).all())


@pytest.mark.anyio
async def test_unos_apuntes_viejos_salen_con_sus_opciones_y_se_encola_un_solo_repintado(cliente) -> None:
    plan_id, mid = await _apuntes(None, "viejo sin opciones")
    r1, r2 = await asyncio.gather(cliente.get(f"/api/materiales/{mid}"), cliente.get(f"/api/materiales/{mid}"))
    for r in (r1, r2):
        assert r.status_code == 200
        texto = r.json()["texto"]
        assert "viejo sin opciones" not in texto and "**a)**" in texto and "Buena" in texto
    r3 = await cliente.get(f"/api/planes/{plan_id}/lecciones/L1/material")
    assert r3.status_code == 200
    trabajos = await _repintados()
    assert len(trabajos) == 1 and trabajos[0].parametros == {"material_id": mid} and trabajos[0].estado == "pendiente"
    m = await almacen.material(mid)
    assert m.versiones == {"apuntes_bloque": "abc123"} and m.montaje is None  # la marca la pone el repintado


@pytest.mark.anyio
async def test_unos_apuntes_al_dia_no_se_tocan(cliente) -> None:
    plan_id, mid = await _apuntes(VERSION_MONTAJE, "al día")
    assert (await cliente.get(f"/api/materiales/{mid}")).json()["texto"] == "al día"
    assert (await cliente.get(f"/api/planes/{plan_id}/lecciones/L1/material")).status_code == 200
    assert await _repintados() == []


@pytest.mark.anyio
async def test_el_repintado_pinta_sin_modelo_y_pone_la_marca(cliente, monkeypatch) -> None:
    from magister.material import render
    from magister.trabajos import material as trabajo_material

    _, mid = await _apuntes(None, "viejo sin opciones")
    visto: dict = {}

    async def pintar(md, plan, clave, nombre="apuntes", estilo="libro"):
        visto.update(md=md, estilo=estilo)
        return render.Render(None, None, error="sin motor en las pruebas")

    monkeypatch.setattr(trabajo_material, "pintar", pintar)
    await cliente.get(f"/api/materiales/{mid}")
    t = (await _repintados())[0]
    await trabajo_material.repintar(t.id, t.parametros)
    assert "**a)**" in visto["md"] and visto["estilo"] == "libro"
    m = await almacen.material(mid)
    assert m.montaje == VERSION_MONTAJE and m.versiones == {"apuntes_bloque": "abc123"} and m.estado == "listo"
    async with nueva_sesion() as s:
        avisos = (await s.get(Trabajo, t.id)).avisos
        assert await s.scalar(select(func.count()).select_from(Pregunta)) == 1
    assert any(a["regla"] == "pintar" for a in avisos)
    # Ya al día: otra visita no encola nada más.
    await cliente.get(f"/api/materiales/{mid}")
    assert len(await _repintados()) == 1
