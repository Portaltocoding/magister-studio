# Magister

Cómo se arranca: pendiente («Guardar la conversación»)

## Mapa de carpetas

| Carpeta o fichero | Qué contiene | Por qué está ahí |
|---|---|---|
| `servidor/pyproject.toml` | Nombre, versión de Python y dependencias | Es el fichero que `uv` lee; sin él no hay proyecto |
| `servidor/src/magister/` | El paquete con `api`, `cerebro`, `datos` y `config.py` | La carpeta `src/` obliga a instalar el paquete para probarlo, y así los tests prueban lo que se despliega |
| `servidor/tests/` | Las pruebas automáticas | `pytest` las busca aquí por convención |
| `servidor/migraciones/` | Los cambios del esquema de Postgres, uno por fichero | Alembic la crea y la espera |
| `web/index.html`, `web/src/` | La única página HTML y lo que se compila | Vite parte de `index.html`; lo que no se compila iría en `web/public/` |
| `proxy/` | La configuración de cada proxy elegible | Fuera de `servidor/` y de `web/`, porque no pertenece a ninguno |
| `escritorio/` | La ventana de Electron que sirve `web/dist` y arranca la API | Es otra forma de servir la misma página; no cambia `web/src` |
| `contrato/` | El esquema de la API y las pruebas de contrato | Lo comparten la página y el servidor |
| `docs/` | Decisiones, criterios y mapas | Texto que explica el proyecto y no se ejecuta |
| `scripts/` | Utilidades sueltas | Herramientas que no forman parte de ningún programa |
| `compose.yaml` | Cómo se levanta Postgres en Docker | Docker Compose lo busca en la raíz |
