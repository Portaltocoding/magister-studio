# La API de Magister Studio en dos etapas (Parte VI, «Todo en Docker Compose»). Sirve para amd64 y arm64 (Mac con M1+).
FROM ghcr.io/astral-sh/uv:0.13.6-python3.12-bookworm-slim AS dependencias
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
COPY pyproject.toml uv.lock README.md ./
RUN uv sync --frozen --no-install-project --no-dev
COPY src ./src
RUN uv sync --frozen --no-dev

# La misma Debian que la etapa de arriba: el .venv se copia tal cual.
FROM python:3.12-slim-bookworm
# Paquetes del sistema:
#   Node 22 (NodeSource) para el CLI de claude, npx (Marp) y el motor del PDF; pandoc y poppler-utils (pdftotext) para
#   el PDF; Chromium para el PDF y las diapositivas; fuentes DejaVu y Liberation para que el PDF y las tarjetas del vídeo
#   no salgan con cuadraditos; ffmpeg para exportar los vídeos; postgresql-client-16 (repositorio PGDG) para las copias
#   de seguridad desde Ajustes (pg_dump 16, como la base).
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates gnupg \
        pandoc poppler-utils chromium fonts-dejavu-core fonts-liberation ffmpeg \
    && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/pgdg.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/pgdg.gpg] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
        > /etc/apt/sources.list.d/pgdg.list \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs postgresql-client-16 \
    && npm install -g @anthropic-ai/claude-code && apt-get clean && rm -rf /var/lib/apt/lists/*

# La voz de Magister (Piper) y sus voces en español. Si la descarga falla, la imagen se construye igual y la app
# funciona sin voz: el tutor no habla en voz alta y exportar vídeo dice que falta Piper. CON_VOZ=0 la quita.
ARG CON_VOZ=1
ARG PIPER_VERSION=2023.11.14-2
ARG TARGETARCH
RUN if [ "$CON_VOZ" = "1" ]; then \
      arq="$([ "$TARGETARCH" = "arm64" ] && echo aarch64 || echo x86_64)"; \
      voces="https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_ES"; \
      ( set -e; mkdir -p /opt/piper-voces \
        && curl -fsSL "https://github.com/rhasspy/piper/releases/download/${PIPER_VERSION}/piper_linux_${arq}.tar.gz" | tar -xz -C /opt \
        && for v in sharvard davefx; do for ext in onnx onnx.json; do \
             curl -fsSL -o "/opt/piper-voces/es_ES-${v}-medium.${ext}" "${voces}/${v}/medium/es_ES-${v}-medium.${ext}"; \
           done; done \
        && test -x /opt/piper/piper ) \
      || { echo "AVISO: no se ha podido instalar Piper; Magister funcionará sin voz"; rm -rf /opt/piper /opt/piper-voces; }; \
    fi

RUN useradd --create-home --uid 1000 magister \
    && mkdir -p /datos /copias && chown magister:magister /datos /copias
WORKDIR /app
COPY --from=dependencias --chown=magister:magister /app /app
COPY --chown=magister:magister migraciones ./migraciones
COPY --chown=magister:magister alembic.ini ./
COPY --chown=magister:magister config ./config
COPY --chown=magister:magister evals ./evals
COPY --chown=magister:magister entrada.sh ./entrada.sh
# Todo lo que se guarda va a /datos (volumen) y las copias de la base a /copias (otro volumen); los modelos de
# embeddings (unos 600 MB) se descargan una vez a /datos/hf y sobreviven a actualizar.
ENV PATH="/app/.venv/bin:$PATH" HOME=/home/magister PYTHONUTF8=1 HF_HOME=/datos/hf \
    MAGISTER_CHECKPOINTS=/datos/checkpoints.sqlite MAGISTER_CRUDO=/datos/crudo MAGISTER_SALIDAS=/datos/salidas \
    MAGISTER_REGISTROS=/datos/registros MAGISTER_SERVIR_WEB=false \
    MAGISTER_VOZ_PIPER=/opt/piper/piper MAGISTER_VOZ_DIR=/opt/piper-voces \
    MAGISTER_CHROME=/usr/bin/chromium MAGISTER_CHROME_ARGS=--no-sandbox CHROME_PATH=/usr/bin/chromium \
    MAGISTER_COPIAS=/copias MAGISTER_CONTENEDOR_DB= MAGISTER_COPIA_DIARIA=true
USER magister
EXPOSE 8000
ENTRYPOINT ["sh", "/app/entrada.sh"]
