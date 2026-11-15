# ADR-0016. Despliegue: Windows nativo por defecto, Docker opcional

**Estado:** aceptada. **Fecha:** 2026-11-15.

**Decisión.** Para el uso diario, `arrancar.ps1`: la base en Docker y la API en Windows, sirviendo también la página en `http://localhost:8000` (un solo puerto). `docker compose --profile docker up -d` levanta todo dentro de Docker (API con el CLI de claude y un token de `claude setup-token` como secreto, y la web con Caddy en el 8080). Copias diarias con `scripts/copia_db.sh` (rotación 7/4/12, cifrado opcional con age) y restauración probada en otra base.

**Consecuencias.** En Docker el PDF de los apuntes no sale todavía: el motor de las fichas lanza el Chrome de Windows. Las diapositivas (Marp) y todo lo demás, sí.
