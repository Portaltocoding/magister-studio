// Magister como aplicación de escritorio.
//
// La ventana carga la misma página de web/dist que se sirve en la web, por un esquema
// propio (magister://app/). Ese esquema hace de proxy: las rutas /api/* se reenvían a una
// API (uvicorn) que esta aplicación arranca en un puerto libre de 127.0.0.1, y lo demás
// son los ficheros de web/dist. Así web/src no cambia: sigue llamando a /api/... relativo.

const { app, BrowserWindow, dialog, net, protocol } = require('electron')
const { spawn, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const http = require('node:net')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const RAIZ = path.resolve(__dirname, '..')
const DIST = path.join(RAIZ, 'web', 'dist')
const SERVIDOR = path.join(RAIZ, 'servidor')
const WEB = path.join(RAIZ, 'web')
const COMPROBAR = process.argv.includes('--comprobar')
// Con --dev (npm run dev): la página se recompila al guardar y la ventana se recarga sola,
// y la API arranca con --reload para reiniciarse al cambiar el servidor.
const DESARROLLO = process.argv.includes('--dev')

protocol.registerSchemesAsPrivileged([
  { scheme: 'magister', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
])

let api = null
let vigilante = null
let ventana = null
let puerto = null
// Un token nuevo en cada arranque: lo recibe la API por entorno (tiene prioridad sobre
// servidor/.env) y lo añade este proxy al reenviar. La página nunca lo ve.
const token = require('node:crypto').randomBytes(32).toString('base64url')

function puertoLibre() {
  return new Promise((resolver, rechazar) => {
    const s = http.createServer()
    s.once('error', rechazar)
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => resolver(port))
    })
  })
}

async function arrancarApi() {
  puerto = await puertoLibre()
  const argumentos = ['run', 'uvicorn', 'magister.api.app:app', '--host', '127.0.0.1', '--port', String(puerto)]
  if (DESARROLLO) argumentos.push('--reload')
  api = spawn('uv', argumentos, {
    cwd: SERVIDOR,
    stdio: 'inherit',
    env: { ...process.env, MAGISTER_TOKEN: token },
  })
  const limite = Date.now() + 30_000
  while (Date.now() < limite) {
    if (api.exitCode !== null) throw new Error('La API se ha cerrado al arrancar.')
    try {
      const r = await fetch(`http://127.0.0.1:${puerto}/api/salud`)
      if (r.ok) return
    } catch {
      // Todavía no escucha.
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error('La API no ha respondido en 30 segundos.')
}

function parar(proceso) {
  if (!proceso || proceso.exitCode !== null) return
  // En Windows, `uv run` deja a Python como hijo: hay que cerrar el árbol entero.
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(proceso.pid), '/T', '/F'])
  else proceso.kill()
}

function pararTodo() {
  parar(api)
  parar(vigilante)
  api = vigilante = null
}

// Solo en desarrollo: `vite build --watch` en web/. Resuelve tras la primera compilación
// y, en las siguientes, recarga la ventana.
function vigilarPagina() {
  return new Promise((resolver, rechazar) => {
    const vite = path.join(WEB, 'node_modules', 'vite', 'bin', 'vite.js')
    vigilante = spawn('node', [vite, 'build', '--watch'], { cwd: WEB, stdio: ['ignore', 'pipe', 'inherit'] })
    vigilante.once('error', rechazar)
    let primera = true
    vigilante.stdout.on('data', (trozo) => {
      process.stdout.write(trozo)
      if (!/built in/.test(trozo.toString())) return
      if (primera) {
        primera = false
        resolver()
      } else if (ventana && !ventana.isDestroyed()) {
        console.log('[escritorio] página recompilada: recargo la ventana')
        ventana.webContents.reloadIgnoringCache()
      }
    })
  })
}

function atender(peticion) {
  const url = new URL(peticion.url)
  if (url.pathname.startsWith('/api/')) {
    // El cuerpo de la respuesta se devuelve tal cual, como flujo: los eventos SSE no se acumulan.
    const cabeceras = new Headers(peticion.headers)
    cabeceras.set('X-Magister-Token', token)
    return net.fetch(`http://127.0.0.1:${puerto}${url.pathname}${url.search}`, {
      method: peticion.method,
      headers: cabeceras,
      body: peticion.body,
      duplex: 'half',
    })
  }
  const fichero = path.normalize(path.join(DIST, decodeURIComponent(url.pathname)))
  const dentro = fichero.startsWith(DIST + path.sep)
  const existe = dentro && fs.existsSync(fichero) && fs.statSync(fichero).isFile()
  return net.fetch(pathToFileURL(existe ? fichero : path.join(DIST, 'index.html')).toString())
}

// Solo con --comprobar: mide desde dentro de la ventana y cierra.
const MEDIR = `(async () => {
  await new Promise((r) => setTimeout(r, 1000))
  const tiempos = async (q) => {
    const t0 = performance.now(), salida = []
    const lector = (await fetch('/api/pulso' + q)).body.getReader()
    const dec = new TextDecoder()
    for (;;) {
      const { done, value } = await lector.read()
      if (done) return salida
      const n = (dec.decode(value).match(/^data:/gm) || []).length
      for (let i = 0; i < n; i++) salida.push(Math.round(performance.now() - t0) / 1000)
    }
  }
  return { estado: document.querySelector('.estado').textContent, normal: await tiempos(''), juntos: await tiempos('?juntos=1') }
})()`

async function iniciar() {
  if (DESARROLLO) await vigilarPagina()
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    dialog.showErrorBox('Magister', 'Falta la página compilada. Ejecuta «npm run build» en web/ y vuelve a abrir.')
    app.quit()
    return
  }
  try {
    await arrancarApi()
  } catch (error) {
    dialog.showErrorBox('Magister', `No se ha podido arrancar la API: ${error.message}`)
    pararTodo()
    app.quit()
    return
  }
  protocol.handle('magister', atender)

  ventana = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Magister',
    // El Hombre de Vitruvio de Leonardo, en líneas (créditos en CREDITOS.md).
    icon: path.join(__dirname, process.platform === 'win32' ? 'icono.ico' : 'icono.png'),
    show: !COMPROBAR,
  })
  ventana.setMenuBarVisibility(false)
  await ventana.loadURL('magister://app/')

  if (COMPROBAR) {
    console.log('COMPROBACION', JSON.stringify(await ventana.webContents.executeJavaScript(MEDIR)))
    app.quit()
  }
}

app.whenReady().then(iniciar)
app.on('window-all-closed', () => app.quit())
app.on('will-quit', pararTodo)
