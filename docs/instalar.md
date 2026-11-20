# Instalar Magister Studio

Magister funciona dentro de **Docker** en Mac, Windows y Linux: no hay que instalar Python, Node ni nada más, y no se construye nada en tu equipo (se descargan imágenes ya hechas). Se abre con doble clic y se usa en el navegador, en **http://localhost:8080**. Todo se queda en tu equipo, salvo las conversaciones con Claude, que van con tu propia cuenta.

## Lo que necesitas

- **Una cuenta de Claude con suscripción Pro o Max**, la tuya. Magister habla con Claude con tu cuenta y gasta de tu suscripción, no de la de otra persona.
- Unos **15 GB libres** en el disco y **8 GB de memoria** como mínimo (mejor 16 GB).
- Internet la primera vez: se descargan unos 3 GB, más Docker si no lo tienes (de 5 a 30 minutos según tu conexión).
- **Docker** no hace falta tenerlo: si falta, el arrancador lo instala (en Linux, no: ver abajo).

## El enlace que hay que enviar

| Equipo | Enlace |
|---|---|
| **Mac** (lo más fácil) | Abrir la app **Terminal**, pegar esta línea y pulsar Intro:<br>`curl -fsSL https://raw.githubusercontent.com/Portaltocoding/magister-studio/main/instalar-mac.sh \| bash` |
| Mac (con zip) | <https://github.com/Portaltocoding/magister-studio/releases/latest/download/Magister-Mac.zip> |
| **Windows** | <https://github.com/Portaltocoding/magister-studio/releases/latest/download/Magister-Windows.zip> |

Los enlaces de los zip no cambian: siempre bajan la última versión publicada.

## Mac

**Opción 1, con Terminal (sin avisos del Mac).** Abre **Terminal** (Cmd+Espacio, escribe «Terminal», Intro), pega la línea de arriba y pulsa Intro. Descarga Magister en la carpeta **Magister** de tu usuario y lo arranca. Como no pasa por el navegador, el Mac no pone pegas.

**Opción 2, con el zip.** Descarga `Magister-Mac.zip`, haz doble clic para descomprimirlo y, en la carpeta, doble clic en **`Magister.command`**. La primera vez el Mac dirá que es de un *desarrollador no identificado* (no está firmado): pulsa **Aceptar**, abre **Ajustes del Sistema → Privacidad y seguridad**, baja hasta el aviso de `Magister.command` y pulsa **Abrir igualmente**.

Lo que verás la primera vez:

1. Si no tienes Docker, lo descarga (el de tu chip, Apple o Intel) y el Mac te pide **tu contraseña** para copiarlo a Aplicaciones.
2. Se abre Docker. En su ventana: **Accept**; si pide tu contraseña, escríbela; si pide iniciar sesión, **Skip** (no hace falta cuenta). Magister espera solo.
3. Descarga Magister (unos 3 GB).
4. Arranca y abre **http://localhost:8080**, donde te recibe la mascota (ver «La bienvenida»).

## Windows

Descarga `Magister-Windows.zip`, clic derecho → **Extraer todo** → **Extraer**, y en la carpeta que sale, doble clic en **`Magister.bat`**. Si sale «Windows protegió su PC»: **Más información → Ejecutar de todas formas**.

Lo que verás la primera vez:

1. Si no tienes Docker, lo instala con `winget`. Cuando Windows pregunte si permites cambios, pulsa **Sí**.
2. Si a Windows le falta WSL (lo que usa Docker), lo instala (otra vez **Sí**) y te pide **reiniciar**. Al volver, doble clic otra vez en `Magister.bat`: sigue donde se quedó. Lo mismo si Docker recién instalado no arranca hasta reiniciar.
3. Se abre Docker. En su ventana: **Accept**; si pide iniciar sesión, **Skip**.
4. Descarga Magister (unos 3 GB).
5. Arranca y abre **http://localhost:8080**, donde te recibe la mascota (ver «La bienvenida»).

## Linux

Instala Docker Engine y el plugin de Compose (<https://docs.docker.com/engine/install/>; en Ubuntu y Debian, `docker-compose-plugin`) y, para usarlo sin `sudo`, `sudo usermod -aG docker $USER` y vuelve a entrar en la sesión. Después descarga `Magister-Mac.zip` (el arrancador es el mismo), descomprímelo y ejecuta `bash sistema/magister.sh`.

## La bienvenida (conectar con Claude sin terminal)

Los arrancadores ya no piden nada en la terminal: arrancan Magister y abren la página. La primera vez, la mascota te recibe en pocos pasos:

1. **¿Cómo te llamo?** Tu nombre se usa en los saludos (se cambia en Ajustes → Bienvenida).
2. **Conecta tu cuenta de Claude.** Pulsa **Conectar con Claude**: se abre una pestaña de Claude; inicia sesión, pulsa **Authorize**, copia el código que te da y pégalo en Magister. Si el código no vale, pulsa **Probar otra vez**. Este paso se salta si ya hay una cuenta conectada.
3. **Una prueba rápida:** la mascota te saluda con la voz y hace una llamada mínima al modelo para confirmar que todo funciona.
4. **¿Qué quieres aprender?** Abre el cuestionario de «Crear mi plan».
5. **¿Tienes apuntes o PDF?** Opcional: te lleva a Biblioteca → Tus fuentes para subirlos.

Se puede saltar (**Saltar la bienvenida**) y se reabre desde **Ajustes → Bienvenida → Ver la bienvenida otra vez**. El token se guarda en el volumen de datos de Magister (`/datos/claude_token`, permisos 600), no en `secretos/`, y no sale nunca de la API.

**Por la terminal (alternativa):** si prefieres no usar la página, ejecuta `claude setup-token` en una terminal y pega el token (empieza por `sk-ant-`) en `secretos/claude_token` antes de arrancar. Lo que se conecte desde la página manda sobre ese fichero.

## Cada día

- **Abrir:** doble clic en `Magister.command` (Mac) o `Magister.bat` (Windows). Si ya está en marcha, solo abre el navegador.
- **Apagar:** doble clic en `Parar Magister.command` o `Parar Magister.bat` (o cierra Docker). Tus datos se quedan guardados.
- **Actualizar:** no hay que hacer nada. Cada vez que lo abres (estando apagado) busca la versión nueva con `docker compose pull` y, si la hay, la descarga. Para tenerla ya: **Parar** y volver a abrir. Si alguna vez una versión trae cambios en los arrancadores, basta con volver a pegar la línea de Terminal (Mac) o descomprimir el zip nuevo **encima** de la carpeta de antes (Windows).

> La carpeta `secretos/` (al lado del arrancador) es tuya: guarda tu conexión con Claude y la contraseña de tu base. No la compartas ni la borres. Si pones Magister en otra carpeta, cópiala a la nueva.

## Tus datos y las copias

- Tus planes, fuentes, apuntes y repasos se guardan en Docker (los volúmenes `magister-studio_magister-studio-datos`, `magister-studio_magister-studio-api` y `magister-studio_magister-studio-copias`), no en la carpeta de Magister. **Sobreviven a apagar, a actualizar y a borrar la carpeta**. Son los mismos con el zip que con el repo.
- Magister hace **una copia de la base cada día** (guarda 7 diarias, 4 semanales y 12 mensuales). Desde **Ajustes** puedes verlas, hacer una ahora y restaurar una.
- Para tener una copia **fuera de Docker**: **Ajustes → Descargar mis datos**.
- Lo único que borra tus datos es eliminar esos volúmenes (`docker volume rm ...`, `docker compose down -v`) o usar «Clean / Purge data» o «Reset to factory defaults» en Docker Desktop. No lo hagas sin una copia fuera.

## Desde el repo (para desarrollar)

Con el repo clonado, `Magister.command`, `Magister-docker.bat` y `magister.sh` hacen lo mismo, pero **construyen** las imágenes con el `compose.yaml` de la raíz (`docker compose --profile docker build`; la primera vez, de 10 a 40 minutos). El paquete usa `distribucion/compose.yaml`, que solo tira de `ghcr.io/portaltocoding/magister-studio-api` y `-web`.

Publicar una versión: las imágenes se construyen solas en cada push a `main` (`:latest`) y en cada etiqueta `v*` (`:1.2.3` y `:estable`, la que usan los paquetes), con `.github/workflows/imagenes.yaml`; la etiqueta además adjunta `Magister-Windows.zip` y `Magister-Mac.zip` a la Release (`scripts/paquetes.sh`). Para sacar una: `git tag v1.0.1 && git push origin v1.0.1`.

## Problemas frecuentes

| Qué pasa | Qué hacer |
|---|---|
| Mac: «desarrollador no identificado» | Usa la línea de Terminal, o **Ajustes del Sistema → Privacidad y seguridad → Abrir igualmente**. |
| Windows: «Windows protegió su PC» | **Más información → Ejecutar de todas formas**. |
| Windows: doble clic en `Magister.bat` y dice que primero descomprimas | Lo has abierto dentro del zip. Clic derecho en el zip → **Extraer todo**, y ábrelo desde la carpeta. |
| «Docker no termina de arrancar» | Reinicia el equipo y vuelve a abrir Magister. Si sigue, abre Docker Desktop a mano y mira si te pide algo. |
| «No he podido descargar Magister» | Revisa la conexión y el espacio libre (15 GB) y vuelve a abrirlo: sigue donde se quedó. |
| El chat responde con un error de Claude o de autenticación | Tu token ha caducado (dura un año). La mascota te vuelve a enseñar el paso «Conecta tu cuenta de Claude»; también puedes ir a Ajustes → Bienvenida → Ver la bienvenida otra vez. |
| «Ya hay datos de Magister en este equipo, pero falta secretos/postgres_password» | Has puesto Magister en otra carpeta: copia la carpeta `secretos/` de la instalación anterior. |
| «otro programa está usando el puerto 8080» | Ciérralo, o arranca con otro puerto: `MAGISTER_DOCKER_PUERTO_WEB=8090 bash sistema/magister.sh` (Mac y Linux) o `$env:MAGISTER_DOCKER_PUERTO_WEB=8090; .\Magister.bat` (PowerShell), y abre http://localhost:8090. |
| Va muy lento o se cierra solo | Dale más memoria a Docker: Docker Desktop → Settings → Resources (8 GB o más). |
| Quiero ver qué está pasando | En una terminal, en la carpeta `sistema`: `docker compose -f compose.yaml logs -f api`. |
