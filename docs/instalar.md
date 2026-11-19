# Instalar Magister Studio

Magister funciona dentro de **Docker** en Mac, Windows y Linux: no hay que instalar Python, Node ni nada más. Se abre con doble clic y se usa en el navegador, en **http://localhost:8080**. Todo se queda en tu equipo, salvo las conversaciones con Claude, que van con tu propia cuenta.

## Lo que necesitas

- **Docker Desktop** (Mac y Windows) o **Docker Engine** (Linux). Gratis para uso personal.
- **Una cuenta de Claude con suscripción Pro o Max**, la tuya. Magister habla con Claude con tu cuenta y gasta de tu suscripción, no de la de otra persona.
- Unos **15 GB libres** en el disco y **8 GB de memoria** como mínimo (mejor 16 GB).
- Internet la primera vez: se descargan varios GB (de 10 a 40 minutos según tu conexión).

## 1. Descargar Magister

Elige una:

- **Sin saber nada de git:** en la página del repositorio, botón verde **Code → Download ZIP**. Descomprímelo en una carpeta que no vayas a mover, por ejemplo `Documentos/Magister`.
- **Con git:** `git clone https://github.com/Portaltocoding/magister-studio.git`

## 2. Instalar Docker y arrancar Magister

### Mac

1. Descarga Docker Desktop desde <https://www.docker.com/products/docker-desktop/> (elige **Apple Silicon** si tu Mac tiene chip M1, M2, M3 o M4; si no, **Intel**). Arrástralo a Aplicaciones, ábrelo una vez y acepta las condiciones.
2. En la carpeta de Magister, doble clic en **`Magister.command`**.
   - Si el Mac dice que no puede abrirlo porque es de un desarrollador no identificado: abre **Ajustes del Sistema → Privacidad y seguridad**, baja hasta el aviso de `Magister.command` y pulsa **Abrir igualmente**. Solo hace falta la primera vez.
   - Si dice que no tienes permiso: abre la app **Terminal**, escribe `bash ` (con un espacio), arrastra `magister.sh` a la ventana y pulsa Intro.

### Windows

1. Descarga Docker Desktop desde <https://www.docker.com/products/docker-desktop/> e instálalo dejando marcada la opción **WSL 2**. Reinicia si te lo pide, ábrelo una vez y acepta las condiciones.
2. En la carpeta de Magister, doble clic en **`Magister-docker.bat`**.
   - Si sale «Windows protegió su PC»: **Más información → Ejecutar de todas formas**. Solo la primera vez.

### Linux

1. Instala Docker Engine y el plugin de Compose siguiendo <https://docs.docker.com/engine/install/> (en Ubuntu y Debian, el paquete `docker-compose-plugin`). Para usarlo sin `sudo`: `sudo usermod -aG docker $USER`, y cierra y vuelve a abrir la sesión.
2. En una terminal, dentro de la carpeta de Magister: `bash magister.sh`

## 3. El primer arranque

El arrancador lo hace todo y te va diciendo qué pasa:

1. Comprueba que Docker está instalado y en marcha (si no lo está, lo abre).
2. Crea la carpeta `secretos/` con una contraseña para tu base de datos.
3. **Te pide tu token de Claude.** Se abre un enlace para iniciar sesión en Claude con tu cuenta; al terminar, sale en pantalla un token largo que empieza por `sk-ant-`. Cópialo y pégalo donde te lo pide. (Si ya tienes Claude Code instalado, es lo mismo que `claude setup-token`.) Se guarda en `secretos/claude_token`, y no hay que repetirlo hasta que caduque, en un año.
4. Prepara y arranca Magister. **La primera vez tarda bastante**; las siguientes, unos segundos.
5. Abre el navegador en **http://localhost:8080**.

Después, para usarlo, vuelve a hacer doble clic en el arrancador. Si ya está en marcha, solo abre el navegador. Para apagarlo: `Magister-docker.bat parar` (Windows) o `bash magister.sh parar` (Mac y Linux), o cierra Docker Desktop.

> La carpeta `secretos/` es tuya: no la compartas ni la subas a ningún sitio. Si descargas Magister de nuevo en otra carpeta, cópiala a la nueva.

## Tus datos y las copias

- Tus planes, fuentes, apuntes y repasos se guardan en Docker (los volúmenes `magister-studio_magister-studio-datos`, `magister-studio_magister-studio-api` y `magister-studio_magister-studio-copias`), no en la carpeta de Magister. **Sobreviven a apagar, a actualizar y a borrar la carpeta**.
- Magister hace **una copia de la base cada día** (guarda 7 diarias, 4 semanales y 12 mensuales). Desde **Ajustes** puedes verlas, hacer una ahora y restaurar una.
- Para tener una copia **fuera de Docker** (por si reinstalas Docker o cambias de equipo): **Ajustes → Descargar mis datos**, o bien, en una terminal dentro de la carpeta de Magister, `docker compose --profile docker cp api:/copias ./copias-docker`.
- Lo único que borra tus datos es eliminar esos volúmenes (`docker volume rm ...`, `docker compose down -v`) o usar «Clean / Purge data» o «Reset to factory defaults» en Docker Desktop. No lo hagas sin una copia fuera.

## Actualizar

1. Consigue la versión nueva:
   - **Con git:** en la carpeta de Magister, `git pull`.
   - **Con el ZIP:** descarga el nuevo y descomprímelo **encima** de la carpeta de antes (sustituyendo los ficheros). Si lo pones en otra carpeta, copia a ella la carpeta `secretos/`.
2. Haz doble clic en el arrancador. Si Magister estaba en marcha, apágalo antes (`parar`) para que se reconstruya con lo nuevo; el arrancador reconstruye lo que haya cambiado y tus datos siguen ahí.

## Problemas frecuentes

| Qué pasa | Qué hacer |
|---|---|
| «No encuentro Docker» | Instala Docker Desktop (o Docker Engine en Linux) y ábrelo una vez antes de abrir Magister. |
| «Docker no termina de arrancar» | Abre Docker Desktop a mano y espera a que diga *Engine running*. En Windows, si habla de WSL, sigue sus instrucciones (suele bastar con `wsl --update` en PowerShell y reiniciar). |
| El chat responde con un error de Claude o de autenticación | Tu token ha caducado o está mal copiado. Borra `secretos/claude_token`, apaga Magister (`parar`) y vuelve a abrirlo: te lo pedirá otra vez. |
| «Ya hay datos de Magister en este equipo, pero falta secretos/postgres_password» | Has descargado Magister en otra carpeta: copia la carpeta `secretos/` de la instalación anterior. |
| «port is already allocated» o el 8080 está ocupado | Otro programa usa el puerto 8080 (o el 5433). Ciérralo, o arranca con otro puerto: `MAGISTER_DOCKER_PUERTO_WEB=8090 bash magister.sh` (Mac y Linux) o `$env:MAGISTER_DOCKER_PUERTO_WEB=8090; .\Magister-docker.bat` (PowerShell), y abre http://localhost:8090. |
| Va muy lento o se cierra solo | Dale más memoria a Docker: Docker Desktop → Settings → Resources (8 GB o más). |
| La primera pregunta sobre tus documentos tarda | La primera vez se descargan los modelos de búsqueda (unos 600 MB). Después ya no. |
| No suena la voz o no se puede descargar el vídeo | La voz se instala al preparar Magister; si en ese momento falló la descarga, apágalo (`parar`), en una terminal en la carpeta de Magister escribe `docker compose --profile docker build --no-cache api` y vuelve a abrirlo. El resto de la app funciona sin voz. |
| Quiero ver qué está pasando | En una terminal en la carpeta de Magister: `docker compose --profile docker logs -f api`. |
