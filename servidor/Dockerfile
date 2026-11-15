# La API de Magister Studio en dos etapas (Parte VI, «Todo en Docker Compose»).
FROM ghcr.io/astral-sh/uv:0.13.6-python3.12-bookworm-slim AS dependencias
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
COPY pyproject.toml uv.lock README.md ./
RUN uv sync --frozen --no-install-project --no-dev
COPY src ./src
RUN uv sync --frozen --no-dev

FROM python:3.12-slim
# Node 22 para el CLI de claude (y npx para Marp), pandoc y pdftotext para el PDF, Chromium para el motor.
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates gnupg pandoc poppler-utils chromium \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y --no-install-recommends nodejs \
    && npm install -g @anthropic-ai/claude-code && apt-get clean && rm -rf /var/lib/apt/lists/*
RUN useradd --create-home --uid 1000 magister
WORKDIR /app
COPY --from=dependencias --chown=magister:magister /app /app
COPY --chown=magister:magister migraciones ./migraciones
COPY --chown=magister:magister alembic.ini ./
COPY --chown=magister:magister config ./config
COPY --chown=magister:magister evals ./evals
COPY --chown=magister:magister entrada.sh ./entrada.sh
ENV PATH="/app/.venv/bin:$PATH" HOME=/home/magister PYTHONUTF8=1 MAGISTER_CHECKPOINTS=/datos/checkpoints.sqlite \
    MAGISTER_CRUDO=/datos/crudo MAGISTER_SALIDAS=/datos/salidas MAGISTER_SERVIR_WEB=false
USER magister
EXPOSE 8000
ENTRYPOINT ["sh", "/app/entrada.sh"]
