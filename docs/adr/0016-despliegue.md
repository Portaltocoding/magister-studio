# ADR-0016. Despliegue: Windows nativo por defecto, Docker opcional

**Estado:** aceptada. **Fecha:** 2026-11-15.

**Decisión.** Para el uso diario, `arrancar.ps1`: la base en Docker y la API en Windows, sirviendo también la página en `http://localhost:8000` (un solo puerto). `docker compose --profile docker up -d` levanta todo dentro de Docker (API con el CLI de claude y un token de `claude setup-token` como secreto, y la web con Caddy en el 8080). Copias diarias con `scripts/copia_db.sh` (rotación 7/4/12, cifrado opcional con age) y restauración probada en otra base.

**Consecuencias.** En Docker el PDF de los apuntes no sale todavía: el motor de las fichas lanza el Chrome de Windows. Las diapositivas (Marp) y todo lo demás, sí.

**Actualización (2026-11-19, sin verificar aún con Docker).** El modo Docker pasa a ser la vía para instalar Magister en otros equipos (Mac, Windows y Linux), con un arrancador por sistema (`Magister.command`, `magister.sh`, `Magister-docker.bat`) y la guía de [`docs/instalar.md`](../instalar.md). El motor del PDF lee el navegador de `MAGISTER_CHROME` (en la imagen, Chromium con `--no-sandbox`); la imagen trae Piper con las voces en español, ffmpeg, fuentes y `postgresql-client-16`; las copias de Ajustes van sin `docker exec` cuando `MAGISTER_CONTENEDOR_DB` está vacío, y la API hace la copia del día (`MAGISTER_COPIA_DIARIA`) en el volumen `magister-studio-copias`. `arrancar.ps1` sigue igual para el uso diario del dueño.
