"""Exportar un vídeo de la lección a MP4: la misma narración que el reproductor, con la voz de Magister (Piper).

Cada escena es una imagen fija (su diapositiva si la lección tiene diapositivas en PDF; si no, una tarjeta con la marca
y la primera frase) y su audio (las frases dichas una tras otra, con un respiro entre ellas). Los WAV de todas las escenas
se juntan en uno solo y ffmpeg codifica una vez: las imágenes, cada una con lo que dura su audio medido, ese único audio
y los subtítulos (pista aparte, se activan en el reproductor). Así cada subtítulo cae donde suena su frase, también al
final de un vídeo largo (unir trozos ya codificados los iba retrasando poco a poco).

El texto llega ya preparado para la voz (glosario de pronunciación aplicado en la web): aquí no se reescribe nada.
Solo importa de `magister.config` (y de la propia voz).
"""

import asyncio
import io
import shutil
import tempfile
import textwrap
import wave
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path

from magister.config import ajustes
from magister.voz import piper

ANCHO, ALTO = 1280, 720
RESPIRO_FRASE = 0.25  # segundos de silencio entre frases
RESPIRO_ESCENA = 0.7  # y al acabar cada escena
PAPEL, TINTA, SUAVE = (251, 249, 244), (34, 32, 30), (120, 114, 106)


class ErrorVideo(Exception):
    pass


@dataclass(frozen=True)
class Frase:
    texto: str  # lo que se ve en el subtítulo
    dicho: str  # lo que dice la voz


@dataclass(frozen=True)
class EscenaVideo:
    marca: str
    frases: tuple[Frase, ...]
    pagina: int | None = None  # página del PDF de diapositivas (desde 1), o None para la tarjeta


# ---------- Audio ----------


def _juntar_wav(partes: list[bytes]) -> tuple[bytes, list[tuple[float, float]]]:
    """Une los WAV de las frases con respiros y devuelve el WAV de la escena y cuándo empieza y acaba cada frase."""
    params = None
    marcos = bytearray()
    tiempos: list[tuple[float, float]] = []
    t = 0.0
    for i, w in enumerate(partes):
        with wave.open(io.BytesIO(w)) as r:
            p = r.getparams()
            if params is None:
                params = p
            elif (p.nchannels, p.sampwidth, p.framerate) != (params.nchannels, params.sampwidth, params.framerate):
                raise ErrorVideo("las frases tienen formatos de audio distintos")
            datos = r.readframes(r.getnframes())
        dur = len(datos) / (p.sampwidth * p.nchannels * p.framerate)
        tiempos.append((t, t + dur))
        marcos += datos
        t += dur
        pausa = RESPIRO_ESCENA if i == len(partes) - 1 else RESPIRO_FRASE
        n = int(pausa * p.framerate) * p.sampwidth * p.nchannels
        marcos += b"\x00" * n
        t += n / (p.sampwidth * p.nchannels * p.framerate)
    if params is None:
        raise ErrorVideo("una escena sin frases")
    salida = io.BytesIO()
    with wave.open(salida, "wb") as w:
        w.setnchannels(params.nchannels)
        w.setsampwidth(params.sampwidth)
        w.setframerate(params.framerate)
        w.writeframes(bytes(marcos))
    return salida.getvalue(), tiempos


def duracion_wav(datos: bytes) -> float:
    with wave.open(io.BytesIO(datos)) as r:
        return r.getnframes() / r.getframerate()


def _encadenar_wav(rutas: list[Path], destino: Path) -> list[float]:
    """Escribe en `destino` los WAV de las escenas uno tras otro (sin tocar sus muestras) y devuelve lo que dura cada
    uno, medido en su cabecera. Lee y escribe por bloques: no carga la lección entera en memoria."""
    duraciones: list[float] = []
    formato = None
    with wave.open(str(destino), "wb") as w:
        for ruta in rutas:
            with wave.open(str(ruta)) as r:
                p = r.getparams()
                if formato is None:
                    formato = (p.nchannels, p.sampwidth, p.framerate)
                    w.setnchannels(p.nchannels)
                    w.setsampwidth(p.sampwidth)
                    w.setframerate(p.framerate)
                elif (p.nchannels, p.sampwidth, p.framerate) != formato:
                    raise ErrorVideo("las escenas tienen formatos de audio distintos")
                while bloque := r.readframes(65536):
                    w.writeframes(bloque)
                duraciones.append(p.nframes / p.framerate)
    if formato is None:
        raise ErrorVideo("el vídeo no tiene escenas")
    return duraciones


def _colocar_subtitulos(por_escena: list[tuple[list[tuple[float, float]], list[str]]],
                        duraciones: list[float]) -> list[tuple[float, float, str]]:
    """Los subtítulos de todo el vídeo: los tiempos de cada frase dentro de su escena, desplazados por lo que duran de
    verdad los audios de las escenas anteriores."""
    salida: list[tuple[float, float, str]] = []
    t0 = 0.0
    for (tiempos, textos), dur in zip(por_escena, duraciones, strict=True):
        salida += [(t0 + a, t0 + b, texto) for (a, b), texto in zip(tiempos, textos)]
        t0 += dur
    return salida


# ---------- Imagen ----------


def _fuente(tam: int, negrita: bool = False):
    from PIL import ImageFont

    for nombre in (("segoeuib.ttf", "arialbd.ttf", "DejaVuSans-Bold.ttf") if negrita else ("segoeui.ttf", "arial.ttf", "DejaVuSans.ttf")):
        try:
            return ImageFont.truetype(nombre, tam)
        except OSError:
            continue
    return ImageFont.load_default(size=tam)


def tarjeta(marca: str, texto: str, destino: Path, titulo: str = "") -> None:
    """La tarjeta de una escena sin diapositiva: la marca arriba, la primera frase grande y el título abajo."""
    from PIL import Image, ImageDraw

    img = Image.new("RGB", (ANCHO, ALTO), PAPEL)
    d = ImageDraw.Draw(img)
    d.text((96, 92), marca.upper(), font=_fuente(30, True), fill=SUAVE)
    d.rectangle((96, 140, 156, 146), fill=TINTA)
    lineas = textwrap.wrap(texto, width=38)[:6]
    if len(textwrap.wrap(texto, width=38)) > 6:
        lineas[-1] = lineas[-1].rstrip(" .,;:") + "…"
    d.multiline_text((96, 190), "\n".join(lineas), font=_fuente(52, True), fill=TINTA, spacing=18)
    if titulo:
        d.text((96, ALTO - 84), titulo, font=_fuente(26), fill=SUAVE)
    img.save(destino, "PNG")


def paginas_pdf(pdf: Path, paginas: list[int], carpeta: Path) -> dict[int, Path]:
    """Pinta esas páginas del PDF (desde 1) a PNG del ancho del vídeo."""
    import pymupdf

    salida: dict[int, Path] = {}
    with pymupdf.open(pdf) as doc:
        for n in sorted(set(paginas)):
            if not 1 <= n <= doc.page_count:
                continue
            pag = doc[n - 1]
            zoom = min(ANCHO / pag.rect.width, ALTO / pag.rect.height)
            pix = pag.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False)
            destino = carpeta / f"pagina-{n:03d}.png"
            pix.save(destino)
            salida[n] = destino
    return salida


def _encajar(ruta: Path) -> None:
    """Deja la imagen justo del tamaño del vídeo (escalada y centrada sobre blanco): todas las escenas van en una sola
    pista y así ninguna cambia de tamaño a mitad."""
    from PIL import Image, ImageOps

    with Image.open(ruta) as img:
        if img.size == (ANCHO, ALTO) and img.mode == "RGB":
            return
        lista = ImageOps.pad(img.convert("RGB"), (ANCHO, ALTO), color=(255, 255, 255))
    lista.save(ruta, "PNG")


# ---------- ffmpeg ----------


async def _ffmpeg(*args: str) -> None:
    exe = shutil.which(ajustes.ffmpeg) or ajustes.ffmpeg
    try:
        proc = await asyncio.create_subprocess_exec(
            exe, "-hide_banner", "-loglevel", "error", "-y", *args,
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE,
        )
    except OSError as e:
        raise ErrorVideo(f"no encuentro ffmpeg ({ajustes.ffmpeg}): {e}") from None
    _, err = await proc.communicate()
    if proc.returncode != 0:
        raise ErrorVideo(f"ffmpeg falló: {err.decode('utf-8', 'replace').strip()[-400:]}")


def _srt(tiempos: list[tuple[float, float, str]]) -> str:
    def t(s: float) -> str:
        ms = int(round(s * 1000))
        return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"

    return "\n".join(f"{i}\n{t(a)} --> {t(b)}\n{texto}\n" for i, (a, b, texto) in enumerate(tiempos, start=1))


FPS = 25


def en_fotogramas(duraciones: list[float], fps: int = FPS) -> list[float]:
    """Las duraciones de las escenas pasadas a fotogramas enteros sin que el error se acumule: se redondea el final de
    cada escena (la suma hasta ella), no cada duración. ffmpeg recortaba cada imagen al fotograma de antes y, con 100
    escenas, la imagen acababa unos 2 s antes que el audio (226,28 frente a 228,29 s) y cada cambio de diapositiva se
    adelantaba un poco más que el anterior."""
    salida: list[float] = []
    antes = 0
    acumulado = 0.0
    for d in duraciones:
        acumulado += d
        fin = max(antes + 1, round(acumulado * fps))
        salida.append((fin - antes) / fps)
        antes = fin
    return salida


def _lista_imagenes(imagenes: list[Path], duraciones: list[float]) -> str:
    """La lista del demuxer concat de ffmpeg: cada imagen con lo que dura su escena, en fotogramas enteros
    (`en_fotogramas`). La última se repite sin duración, porque si no ffmpeg ignora la duración de la última entrada."""
    if not imagenes or len(imagenes) != len(duraciones):
        raise ErrorVideo("las imágenes no cuadran con las escenas")
    lineas = ["ffconcat version 1.0"]
    for img, dur in zip(imagenes, en_fotogramas(duraciones)):
        lineas += [f"file '{img.name}'", f"duration {dur:.6f}"]
    lineas.append(f"file '{imagenes[-1].name}'")
    return "\n".join(lineas) + "\n"


def _orden_montaje(lista: Path, audio: Path, srt: Path, salida: Path, total: float, titulo: str) -> list[str]:
    """Los argumentos de la única pasada de ffmpeg: imágenes (lista concat), un solo audio y los subtítulos, todo
    codificado a la vez y cortado a lo que dura el audio. La última imagen se alarga (tpad) y `-t` la corta: la pista
    de vídeo nunca acaba antes que la voz."""
    return [
        "-f", "concat", "-safe", "0", "-i", str(lista), "-i", str(audio), "-i", str(srt),
        "-map", "0:v", "-map", "1:a", "-map", "2:s",
        "-vf", f"fps={FPS},format=yuv420p,tpad=stop_mode=clone:stop_duration=2", "-c:v", "libx264", "-preset", "veryfast",
        "-tune", "stillimage", "-r", str(FPS),
        "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "1",
        "-c:s", "mov_text", "-metadata:s:s:0", "language=spa", "-metadata", f"title={titulo}",
        "-t", f"{total:.3f}", "-movflags", "+faststart", str(salida),
    ]


Avance = Callable[[int, int], Awaitable[None]]


async def exportar(escenas: list[EscenaVideo], voz_id: str, destino: Path, *, pdf: Path | None = None, titulo: str = "",
                   avance: Avance | None = None) -> float:
    """Monta el MP4 en `destino` y devuelve su duración en segundos. `avance(paso, total)` se llama tras cada escena
    (y puede lanzar una excepción para cancelar)."""
    escenas = [e for e in escenas if e.frases]
    if not escenas:
        raise ErrorVideo("el vídeo no tiene escenas")
    if not any(v.id == voz_id for v in piper.disponibles()):
        raise ErrorVideo("para descargar el vídeo hace falta la voz de Magister (Piper) instalada")
    carpeta = Path(await asyncio.to_thread(tempfile.mkdtemp, prefix="magister-video-"))
    try:
        imagenes: dict[int, Path] = {}
        if pdf is not None and pdf.exists():
            imagenes = await asyncio.to_thread(paginas_pdf, pdf, [e.pagina for e in escenas if e.pagina], carpeta)
        for ruta in imagenes.values():
            await asyncio.to_thread(_encajar, ruta)
        audios: list[Path] = []
        fotos: list[Path] = []
        por_escena: list[tuple[list[tuple[float, float]], list[str]]] = []
        for i, e in enumerate(escenas):
            wavs = [await piper.sintetizar(f.dicho, voz_id) for f in e.frases]
            audio, tiempos = await asyncio.to_thread(_juntar_wav, wavs)
            ruta_audio = carpeta / f"escena-{i:03d}.wav"
            await asyncio.to_thread(ruta_audio.write_bytes, audio)
            imagen = imagenes.get(e.pagina or 0)
            if imagen is None:
                imagen = carpeta / f"tarjeta-{i:03d}.png"
                await asyncio.to_thread(tarjeta, e.marca, e.frases[0].texto, imagen, titulo)
            audios.append(ruta_audio)
            fotos.append(imagen)
            por_escena.append((tiempos, [f.texto for f in e.frases]))
            if avance:
                await avance(i + 1, len(escenas))
        # Un solo audio con todas las escenas seguidas; las duraciones salen de medirlo, no de una estimación.
        voz = carpeta / "voz.wav"
        duraciones = await asyncio.to_thread(_encadenar_wav, audios, voz)
        total = sum(duraciones)
        lista = carpeta / "imagenes.txt"
        await asyncio.to_thread(lista.write_text, _lista_imagenes(fotos, duraciones), encoding="utf-8")
        srt = carpeta / "subtitulos.srt"
        await asyncio.to_thread(srt.write_text, _srt(_colocar_subtitulos(por_escena, duraciones)), encoding="utf-8")
        await asyncio.to_thread(destino.parent.mkdir, parents=True, exist_ok=True)
        provisional = destino.with_suffix(".tmp.mp4")
        await _ffmpeg(*_orden_montaje(lista, voz, srt, provisional, total, titulo))
        await asyncio.to_thread(provisional.replace, destino)
        return total
    finally:
        await asyncio.to_thread(shutil.rmtree, carpeta, True)
