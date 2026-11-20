# Créditos

## Icono: el Hombre de Vitruvio

`escritorio/icono.png`, `escritorio/icono.ico` y `web/public/favicon.png` salen de
[Da Vinci Vitruvian Man traced.svg](https://commons.wikimedia.org/wiki/File:Da_Vinci_Vitruvian_Man_traced.svg),
el dibujo de Leonardo da Vinci calcado en líneas. Vectorización de Transoxsiana, en Wikimedia Commons.

- Licencia: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Los iconos derivados se comparten con la misma licencia.
- Cambios: recortado a un cuadrado, con fondo blanco, reducido a tamaños de icono y con las líneas engrosadas en los tamaños pequeños para que se vean.

## Componentes de los paquetes sin Docker

`Magister-Windows-sin-Docker.zip` lleva dentro estos programas de terceros, sin cambios salvo lo indicado; el de Mac los instala con Homebrew. Cada uno conserva su licencia y se publican sus fuentes en el enlace.

- [PostgreSQL](https://www.postgresql.org/) 16, binarios portables de EDB: licencia PostgreSQL (permisiva). Sin pgAdmin ni documentación.
- [pgvector](https://github.com/pgvector/pgvector) 0.8.0, construido en CI con MSVC: licencia PostgreSQL.
- [ffmpeg](https://ffmpeg.org/) (compilación GPL de [BtbN](https://github.com/BtbN/FFmpeg-Builds), con libx264): licencia GPL v3. Solo el ejecutable `ffmpeg.exe`, sin modificar; fuentes en <https://github.com/BtbN/FFmpeg-Builds> y <https://ffmpeg.org/download.html>. Magister lo lanza como programa aparte.
- [Piper](https://github.com/rhasspy/piper) 2023.11.14-2 para Windows y las voces `es_ES-davefx-medium` y `es_ES-sharvard-medium`: ver más abajo.
- [uv](https://github.com/astral-sh/uv) 0.13.6: licencia MIT o Apache 2.0.
- [Node.js](https://nodejs.org/) 22: licencia MIT (con las de sus dependencias incluidas).
- [pandoc](https://pandoc.org/) 3.6.1: licencia GPL v2 o posterior. Sin modificar; fuentes en <https://github.com/jgm/pandoc>. Magister lo lanza como programa aparte.
- [poppler](https://poppler.freedesktop.org/) 24.08.0 (`pdftotext`, compilación de [oschwartz10612](https://github.com/oschwartz10612/poppler-windows)): licencia GPL v2 o v3. Sin modificar; fuentes en <https://gitlab.freedesktop.org/poppler/poppler>. Magister lo lanza como programa aparte.
- [Git para Windows](https://gitforwindows.org/) (PortableGit) 2.47.1, que necesita Claude en Windows: licencia GPL v2 (y las de sus componentes). Sin modificar; fuentes en <https://github.com/git-for-windows/git>. Se descomprime solo si el equipo no tiene Git.
- [Homebrew](https://brew.sh/) (solo en Mac, lo instala el arrancador): licencia BSD 2-Clause. Instala PostgreSQL, ffmpeg, uv, Node, pandoc y poppler con las licencias de arriba.
- [Claude Code](https://claude.com/product/claude-code), instalado con el instalador oficial de Anthropic (no se redistribuye en el zip): sujeto a los [términos de Anthropic](https://www.anthropic.com/legal/commercial-terms).

## Modelos y voces dentro de la imagen de la API

La imagen `ghcr.io/portaltocoding/magister-studio-api` trae ya descargados, sin cambios:

- [intfloat/multilingual-e5-small](https://huggingface.co/intfloat/multilingual-e5-small) (embeddings): licencia MIT.
- [cross-encoder/mmarco-mMiniLMv2-L12-H384-v1](https://huggingface.co/cross-encoder/mmarco-mMiniLMv2-L12-H384-v1) (reranker): licencia Apache 2.0.
- [Piper](https://github.com/rhasspy/piper) 2023.11.14-2 (la voz local): licencia MIT.
- Voces de [rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices):
  - `es_ES-davefx-medium`: datos con licencia CC0.
  - `es_ES-sharvard-medium`: entrenada con el corpus Sharvard (Aubanel, García Lecumberri y Cooke, Universidad de Edimburgo, <https://datashare.ed.ac.uk/handle/10283/574>), con licencia [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/).
