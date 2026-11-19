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


def test_las_escenas_se_encadenan_en_un_solo_wav_y_se_mide_cada_una(tmp_path) -> None:
    rutas = []
    for i, s in enumerate((1.37, 0.5, 2.013)):
        rutas.append(tmp_path / f"e{i}.wav")
        rutas[-1].write_bytes(_wav(s))
    duraciones = video._encadenar_wav(rutas, tmp_path / "voz.wav")
    assert duraciones == pytest.approx([1.37, 0.5, 2.013], abs=1e-4)
    assert video.duracion_wav((tmp_path / "voz.wav").read_bytes()) == pytest.approx(sum(duraciones), abs=1e-9)
    (tmp_path / "otra.wav").write_bytes(_wav(0.2, hz=16000))
    with pytest.raises(video.ErrorVideo):
        video._encadenar_wav([rutas[0], tmp_path / "otra.wav"], tmp_path / "mal.wav")


def test_los_subtitulos_se_desplazan_por_lo_que_dura_cada_escena() -> None:
    subs = video._colocar_subtitulos(
        [([(0.0, 1.0), (1.25, 2.0)], ["A.", "B."]), ([(0.0, 0.5)], ["C."]), ([(0.1, 0.9)], ["D."])],
        [2.7, 1.2, 1.6],
    )
    assert [t for _, _, t in subs] == ["A.", "B.", "C.", "D."]
    assert subs[2][:2] == pytest.approx((2.7, 3.2)) and subs[3][:2] == pytest.approx((4.0, 4.8))
    with pytest.raises(ValueError):
        video._colocar_subtitulos([([(0.0, 1.0)], ["A."])], [1.0, 2.0])


def test_lista_de_imagenes_con_su_duracion(tmp_path) -> None:
    lista = video._lista_imagenes([tmp_path / "a.png", tmp_path / "b.png"], [1.5, 2.25])
    assert lista.splitlines() == [
        "ffconcat version 1.0", "file 'a.png'", "duration 1.500000", "file 'b.png'", "duration 2.250000", "file 'b.png'",
    ]
    with pytest.raises(video.ErrorVideo):
        video._lista_imagenes([tmp_path / "a.png"], [1.0, 2.0])


def test_una_sola_codificacion_con_imagenes_audio_y_subtitulos(tmp_path) -> None:
    orden = video._orden_montaje(tmp_path / "l.txt", tmp_path / "v.wav", tmp_path / "s.srt", tmp_path / "o.mp4", 12.3456, "L1")
    assert orden[:3] == ["-f", "concat", "-safe"] and orden[-1] == str(tmp_path / "o.mp4")
    assert "copy" not in orden  # nada de unir trozos ya codificados
    assert [orden[i + 1] for i, x in enumerate(orden) if x == "-map"] == ["0:v", "1:a", "2:s"]
    assert [orden[i + 1] for i, x in enumerate(orden) if x == "-i"] == [str(tmp_path / n) for n in ("l.txt", "v.wav", "s.srt")]
    assert "libx264" in orden and "aac" in orden and "mov_text" in orden
    assert orden[orden.index("-t") + 1] == "12.346"


@pytest.mark.anyio
async def test_exportar_codifica_una_vez_y_los_subtitulos_salen_de_los_wav(monkeypatch, tmp_path) -> None:
    from PIL import Image

    from magister.voz import piper

    monkeypatch.setattr(piper, "disponibles", lambda: [piper.Voz("sharvard-f", "Sharvard", "x.onnx", 1)])
    # Duraciones raras a propósito: nada de esto se puede estimar contando palabras.
    largos = {"uno": 1.37, "dos": 0.81, "tres": 2.013, "cuatro": 0.4}

    async def sintetizar(texto: str, voz_id: str) -> bytes:
        return _wav(largos[texto])

    monkeypatch.setattr(piper, "sintetizar", sintetizar)
    llamadas: list[list[str]] = []
    vistos: dict[str, str] = {}

    async def ffmpeg_falso(*args: str) -> None:
        llamadas.append(list(args))
        entradas = [args[i + 1] for i, x in enumerate(args) if x == "-i"]
        vistos["lista"] = Path(entradas[0]).read_text(encoding="utf-8")
        vistos["srt"] = Path(entradas[2]).read_text(encoding="utf-8")
        vistos["voz"] = str(video.duracion_wav(Path(entradas[1]).read_bytes()))
        for linea in vistos["lista"].splitlines():
            if linea.startswith("file "):
                with Image.open(Path(entradas[0]).parent / linea[6:-1]) as img:
                    assert img.size == (video.ANCHO, video.ALTO)
        Path(args[-1]).write_bytes(b"mp4")

    monkeypatch.setattr(video, "_ffmpeg", ffmpeg_falso)
    pasos: list[tuple[int, int]] = []

    async def avance(paso: int, total: int) -> None:
        pasos.append((paso, total))

    escenas = [
        video.EscenaVideo("intuicion", (video.Frase("Uno.", "uno"), video.Frase("Dos.", "dos"))),
        video.EscenaVideo("teoria", (video.Frase("Tres.", "tres"),)),
        video.EscenaVideo("vacia", ()),
        video.EscenaVideo("cierre", (video.Frase("Cuatro.", "cuatro"),)),
    ]
    destino = tmp_path / "sal" / "v.mp4"
    total = await video.exportar(escenas, "sharvard-f", destino, titulo="L1", avance=avance)

    assert len(llamadas) == 1  # una sola pasada de ffmpeg
    assert destino.read_bytes() == b"mp4" and not destino.with_suffix(".tmp.mp4").exists()
    assert pasos == [(1, 3), (2, 3), (3, 3)]
    f, e = video.RESPIRO_FRASE, video.RESPIRO_ESCENA
    d1, d2, d3 = 1.37 + f + 0.81 + e, 2.013 + e, 0.4 + e
    assert total == pytest.approx(d1 + d2 + d3, abs=1e-3)
    assert float(vistos["voz"]) == pytest.approx(total, abs=1e-9)
    duraciones = [float(x.split()[1]) for x in vistos["lista"].splitlines() if x.startswith("duration ")]
    assert duraciones == pytest.approx([d1, d2, d3], abs=1e-3)
    assert sum(duraciones) == pytest.approx(total, abs=1e-5)  # la imagen dura lo mismo que el audio
    # El subtítulo de la última escena empieza justo donde acaba el audio de las anteriores.
    subs = {}
    for bloque in vistos["srt"].strip().split("\n\n"):
        _, tiempos, texto = bloque.splitlines()
        subs[texto] = [_segundos(x) for x in tiempos.split(" --> ")]
    assert list(subs) == ["Uno.", "Dos.", "Tres.", "Cuatro."]
    assert subs["Dos."] == pytest.approx([1.37 + f, 1.37 + f + 0.81], abs=2e-3)
    assert subs["Tres."] == pytest.approx([d1, d1 + 2.013], abs=2e-3)
    assert subs["Cuatro."] == pytest.approx([d1 + d2, d1 + d2 + 0.4], abs=2e-3)


def _segundos(t: str) -> float:
    h, m, resto = t.split(":")
    s, ms = resto.split(",")
    return int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000


@pytest.mark.anyio
async def test_ffmpeg_es_el_de_magister_ffmpeg(monkeypatch) -> None:
    from magister.config import ajustes

    monkeypatch.setattr(ajustes, "ffmpeg", "C:/herramientas/mi-ffmpeg.exe")
    lanzados: list[tuple] = []

    class Proc:
        returncode = 0

        async def communicate(self):
            return b"", b""

    async def lanzar(*args, **kw):
        lanzados.append(args)
        return Proc()

    monkeypatch.setattr(video.asyncio, "create_subprocess_exec", lanzar)
    await video._ffmpeg("-i", "x")
    assert lanzados[0][0] == "C:/herramientas/mi-ffmpeg.exe" and lanzados[0][-2:] == ("-i", "x")


def test_una_pagina_se_encaja_al_tamano_del_video(tmp_path) -> None:
    from PIL import Image

    ruta = tmp_path / "pagina.png"
    Image.new("RGBA", (991, 720), (0, 0, 0, 255)).save(ruta)
    video._encajar(ruta)
    with Image.open(ruta) as img:
        assert img.size == (video.ANCHO, video.ALTO) and img.mode == "RGB"
        assert img.getpixel((5, 360)) == (255, 255, 255) and img.getpixel((640, 360)) == (0, 0, 0)


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
