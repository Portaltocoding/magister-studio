"""Descargar un vídeo en MP4: audio por escenas, subtítulos, la tarjeta y el trabajo de la cola (sin Piper ni ffmpeg)."""

import io
import json
import wave
from pathlib import Path

import pytest

from magister.voz import video


def _wav(segundos: float, hz: int = 22050) -> bytes:
    b = io.BytesIO()
    with wave.open(b, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(hz)
        w.writeframes(b"\x01\x00" * int(segundos * hz))
    return b.getvalue()


def test_las_frases_se_juntan_con_respiros_y_sus_tiempos() -> None:
    audio, tiempos = video._juntar_wav([_wav(1.0), _wav(0.5)])
    assert tiempos[0] == pytest.approx((0.0, 1.0), abs=1e-3)
    assert tiempos[1] == pytest.approx((1.0 + video.RESPIRO_FRASE, 1.5 + video.RESPIRO_FRASE), abs=1e-3)
    assert video.duracion_wav(audio) == pytest.approx(1.5 + video.RESPIRO_FRASE + video.RESPIRO_ESCENA, abs=1e-3)
    with pytest.raises(video.ErrorVideo):
        video._juntar_wav([_wav(0.2), _wav(0.2, hz=16000)])


def test_subtitulos_srt() -> None:
    srt = video._srt([(0.0, 1.25, "Hola."), (3661.5, 3662.0, "Adiós.")])
    assert "1\n00:00:00,000 --> 00:00:01,250\nHola.\n" in srt and "2\n01:01:01,500 --> 01:01:02,000\nAdiós.\n" in srt


def test_tarjeta_de_escena(tmp_path) -> None:
    from PIL import Image

    destino = tmp_path / "t.png"
    video.tarjeta("choque", "Una frase muy larga " * 20, destino, "L1 · Prueba")
    with Image.open(destino) as img:
        assert img.size == (video.ANCHO, video.ALTO)


@pytest.mark.anyio
async def test_pedir_hacer_y_bajar_el_mp4(cliente, monkeypatch, tmp_path) -> None:
    from magister.config import ajustes
    from magister.material import almacen
    from magister.trabajos.trabajador import ejecutar_uno
    from magister.voz import piper

    from tests.test_material import plan_aceptado

    monkeypatch.setattr(ajustes, "salidas", str(tmp_path))
    monkeypatch.setattr(piper, "disponibles", lambda: [piper.Voz("sharvard-f", "Sharvard", "x.onnx", 1)])
    hechas: list = []

    async def exportar_falso(escenas, voz_id, destino: Path, *, pdf=None, titulo="", avance=None):
        hechas.append((escenas, voz_id, pdf, titulo))
        destino.parent.mkdir(parents=True, exist_ok=True)
        destino.write_bytes(b"mp4")
        for i in range(len(escenas)):
            await avance(i + 1, len(escenas))
        return 12.0

    monkeypatch.setattr(video, "exportar", exportar_falso)
    plan_id = await plan_aceptado()
    mid = await almacen.nuevo_material(plan_id, "L1", "guion", None)
    cuerpo = {"voz": "sharvard-f", "titulo": "L1", "escenas": [
        {"marca": "intuicion", "frases": [{"texto": "SQL es fácil.", "dicho": "ese cu ele es fácil."}], "pagina": None},
        {"marca": "teoria", "frases": [{"texto": "Fin."}]},
    ]}
    assert (await cliente.get(f"/api/materiales/{mid}/mp4")).json()["listo"] is False
    r = (await cliente.post(f"/api/materiales/{mid}/mp4", json=cuerpo)).json()
    assert r["trabajo_id"] and r["listo"] is False
    # Pedirlo otra vez igual no encola otro trabajo.
    assert (await cliente.post(f"/api/materiales/{mid}/mp4", json=cuerpo)).json()["trabajo_id"] == r["trabajo_id"]

    assert await ejecutar_uno("t1")
    escenas, voz, pdf, _ = hechas[0]
    assert voz == "sharvard-f" and pdf is None and escenas[0].frases[0].dicho == "ese cu ele es fácil."
    assert escenas[1].frases[0].dicho == "Fin."  # sin «dicho», la voz lee el texto
    estado = (await cliente.get(f"/api/materiales/{mid}/mp4")).json()
    assert estado["listo"] and estado["segundos"] == 12.0 and estado["trabajo"]["estado"] == "hecho"
    assert estado["trabajo"]["paso"] == 2 and estado["trabajo"]["total"] == 2
    bajada = await cliente.get(f"/api/materiales/{mid}/mp4/fichero")
    assert bajada.status_code == 200 and bajada.content == b"mp4" and "attachment" in bajada.headers["content-disposition"]
    # Ya hecho con esas escenas y esa voz: no se rehace.
    assert (await cliente.post(f"/api/materiales/{mid}/mp4", json=cuerpo)).json() == {"trabajo_id": None, "listo": True}
    meta = json.loads((tmp_path / f"{plan_id}-L1" / f"video-{mid}.json").read_text(encoding="utf-8"))
    assert meta["voz"] == "sharvard-f"
    # Borrar el vídeo borra también su MP4 y su ficha.
    assert (await cliente.delete(f"/api/materiales/{mid}")).status_code == 204
    assert not (tmp_path / f"{plan_id}-L1" / f"video-{mid}.mp4").exists()
    assert not (tmp_path / f"{plan_id}-L1" / f"video-{mid}.json").exists()


@pytest.mark.anyio
async def test_borrar_el_video_mientras_se_monta_lo_para(cliente, monkeypatch, tmp_path) -> None:
    from magister.config import ajustes
    from magister.material import almacen
    from magister.trabajos import cola
    from magister.trabajos.trabajador import ejecutar_uno
    from magister.voz import piper

    from tests.test_material import plan_aceptado

    monkeypatch.setattr(ajustes, "salidas", str(tmp_path))
    monkeypatch.setattr(piper, "disponibles", lambda: [piper.Voz("sharvard-f", "Sharvard", "x.onnx", 1)])
    plan_id = await plan_aceptado()
    mid = await almacen.nuevo_material(plan_id, "L1", "guion", None)

    async def exportar_mientras_borras(escenas, voz_id, destino: Path, *, pdf=None, titulo="", avance=None):
        # Borras el vídeo mientras ffmpeg monta, y ffmpeg acaba sin pasar por otro avance.
        assert (await cliente.delete(f"/api/materiales/{mid}")).status_code == 204
        destino.parent.mkdir(parents=True, exist_ok=True)
        destino.write_bytes(b"mp4")
        return 5.0

    monkeypatch.setattr(video, "exportar", exportar_mientras_borras)
    cuerpo = {"voz": "sharvard-f", "titulo": "L1", "escenas": [{"marca": "teoria", "frases": [{"texto": "Fin."}]}]}
    tid = (await cliente.post(f"/api/materiales/{mid}/mp4", json=cuerpo)).json()["trabajo_id"]
    assert await ejecutar_uno("t1")
    assert (await cola.leer(tid))["estado"] == "cancelado"
    assert not (tmp_path / f"{plan_id}-L1" / f"video-{mid}.mp4").exists()
    assert not (tmp_path / f"{plan_id}-L1" / f"video-{mid}.json").exists()


@pytest.mark.anyio
async def test_sin_piper_no_se_pide_y_sin_guion_404(cliente, monkeypatch) -> None:
    from magister.material import almacen
    from magister.voz import piper

    from tests.test_material import plan_aceptado

    monkeypatch.setattr(piper, "disponibles", lambda: [])
    plan_id = await plan_aceptado()
    mid = await almacen.nuevo_material(plan_id, "L1", "guion", None)
    cuerpo = {"voz": "sharvard-f", "escenas": [{"frases": [{"texto": "Hola."}]}]}
    assert (await cliente.post(f"/api/materiales/{mid}/mp4", json=cuerpo)).status_code == 409
    apuntes = await almacen.nuevo_material(plan_id, "L1", "apuntes", None)
    assert (await cliente.get(f"/api/materiales/{apuntes}/mp4")).status_code == 404
    assert (await cliente.get(f"/api/materiales/{mid}/mp4/fichero")).status_code == 404
