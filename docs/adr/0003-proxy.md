# ADR-0003. El proxy entre la página y la API

**Estado:** aceptada. **Fecha:** 2026-11-06.

**Contexto.** La página (Vite, puerto 5173) y la API (uvicorn, puerto 8000) son dos programas en dos puertos, y el navegador no deja que una página pida a otro origen sin abrir CORS.

**Decisión.** Variante B: Caddy escucha en el 8080 (`proxy/Caddyfile`), reenvía `/api/*` al 8000 con `flush_interval -1` para que el flujo SSE no se acumule, y lo demás al 5173. La página llama a `/api/...` como ruta relativa.

**Alternativas.** Proxy de Vite: no hay nada que instalar, pero solo existe en desarrollo. Pasarela propia (FastAPI sirve `web/dist`): un solo programa, pero sin recarga en caliente. Sin proxy (CORS abierto): expone el servidor y se rompe al desplegar. Escritorio: se monta aparte, en `escritorio/` (Electron), como otra forma de servir la misma página; no sustituye a Caddy en la web, y por ahora habla con la API por HTTP en `127.0.0.1`, no por un canal local sin red.

**Consecuencia.** En otra máquina hay que instalar Caddy y arrancar tres procesos (uvicorn, Vite y Caddy). A cambio, la configuración se parece a la de producción, y el token del paso 8 se añadirá con `header_up` en el mismo fichero.
