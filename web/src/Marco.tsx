import { useCallback, useEffect, useRef, useState } from 'react'
import { hoyIso, listarConversaciones, verBienvenida, type Conversacion } from './api.ts'
import BarraLateral from './BarraLateral.tsx'
import BarraSesion from './BarraSesion.tsx'
import Riel, { pendienteDeHoy, usarHoy } from './Riel.tsx'
import Paleta from './componentes/Paleta.tsx'
import { avisosActivos } from './componentes/Afinar.tsx'
import Asesor from './componentes/Asesor.tsx'
import Bienvenida from './componentes/Bienvenida.tsx'
import { EVENTO_BIENVENIDA, EVENTO_CUENTA_CAIDA, modoDe, type Modo } from './componentes/bienvenida.ts'
import { avisar } from './componentes/pomodoro.ts'
import { acentoDe, sincronizarAcento, usarColores, variables } from './componentes/colores.ts'
import Central from './Central.tsx'
import { grupoDe, MODOS, type IdModo } from './modos.ts'
import { claveSeccion } from './componentes/tema.ts'
import { hayQueEscribir, leerRuta, rutaDe } from './rutas.ts'

// El modo y la conversación viajan en la URL (#/roadmap, #/conversacion/6, #/nuevo-plan): recargar no te saca de donde
// estabas y se puede enlazar una vista. Lo que eliges tú (barra lateral, riel, pestañas, un botón que lleva a otra
// pantalla) deja entrada en la historia, y Atrás y Adelante te devuelven; lo que la app corrige sola (la ruta vacía,
// la conversación recién creada) la sustituye.
function escribirRuta(ruta: string, apilar: boolean) {
  if (!hayQueEscribir(window.location.hash, ruta)) return
  if (apilar) window.history.pushState(null, '', ruta)
  else window.history.replaceState(null, '', ruta)
}

// Tres zonas: la barra lateral y la barra de sesión no cambian;
// la zona central recibe el modo activo y pinta lo suyo.
export default function Marco() {
  const inicial = leerRuta(window.location.hash)
  const [modo, setModo] = useState<IdModo>(inicial.modo)
  const [conversaciones, setConversaciones] = useState<Conversacion[]>([])
  const [activa, setActiva] = useState<number | null>(inicial.conversacion)
  // La barra lateral va siempre plegada (queda la tira de iconos) y se abre por encima del contenido;
  // se vuelve a plegar al elegir algo, al pulsar fuera o con Esc. Ctrl+B la abre y la cierra.
  const [menu, setMenu] = useState(false)
  // Fijada: la barra lateral ocupa su sitio y no se cierra sola. Sin fijar: tira de iconos y se abre por encima.
  const [fija, setFija] = useState(() => {
    try {
      return localStorage.getItem('magister-lateral-fija') === 'si'
    } catch {
      return false
    }
  })
  const fijar = useCallback((si: boolean) => {
    setFija(si)
    setMenu(false)
    try {
      localStorage.setItem('magister-lateral-fija', si ? 'si' : 'no')
    } catch {
      /* sin almacenamiento */
    }
  }, [])
  const hoy = usarHoy()
  useEffect(() => {
    const nombre = MODOS.find((m) => m.id === modo)?.nombre
    document.title = nombre ? `${nombre} · Magister` : 'Magister'
  }, [modo])
  useEffect(() => {
    if (!hoy || !('Notification' in window) || Notification.permission !== 'granted' || !avisosActivos()) return
    const fecha = hoyIso()
    const clave = `magister-avisado-${fecha}`
    try {
      if (localStorage.getItem(clave)) return
    } catch {
      return
    }
    const p = pendienteDeHoy(hoy)
    if (!p.n) return
    const [h, m] = (hoy.inicio ?? '00:00').split(':').map(Number)
    const espera = Math.max(0, new Date().setHours(h, m, 0, 0) - Date.now())
    const t = window.setTimeout(() => {
      avisar('Magister · Hoy', p.texto.replace(/^Hoy: /, ''))
      try {
        localStorage.setItem(clave, 'si')
      } catch {
        /* sin almacenamiento */
      }
    }, espera)
    return () => window.clearTimeout(t)
  }, [hoy])
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        setMenu((x) => !x)
      } else if (e.key === 'Escape') setMenu(false)
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [])
  // El acento elegido vale para toda la app (Progreso, Tutor, foco), no solo para Lecciones.
  const [colores] = usarColores()
  // Al abrir, el servidor se entera del acento (por si lo cambiaste en otro navegador o antes de esto).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => sincronizarAcento(colores), [])
  useEffect(() => setMenu(false), [modo, activa])
  // La bienvenida de la primera vez (o el paso de Claude, si la cuenta ha caducado): lo decide el servidor.
  const [bienvenida, setBienvenida] = useState<{ modo: Modo; nombre: string; cuentaConectada: boolean } | null>(null)
  const mirarBienvenida = useCallback(() => {
    verBienvenida()
      .then((e) => {
        const modo = modoDe(e)
        if (modo) setBienvenida((abierta) => abierta ?? { modo, nombre: e.nombre, cuentaConectada: e.cuenta.conectada })
      })
      .catch(() => undefined)
  }, [])
  useEffect(() => {
    mirarBienvenida()
    // Una petición ha fallado por la cuenta de Claude, o se reabre desde Ajustes.
    window.addEventListener(EVENTO_CUENTA_CAIDA, mirarBienvenida)
    window.addEventListener(EVENTO_BIENVENIDA, mirarBienvenida)
    return () => {
      window.removeEventListener(EVENTO_CUENTA_CAIDA, mirarBienvenida)
      window.removeEventListener(EVENTO_BIENVENIDA, mirarBienvenida)
    }
  }, [mirarBienvenida])
  const [tipoNueva, setTipoNueva] = useState<'libre' | 'plan'>(() => (inicial.nuevoPlan ? 'plan' : 'libre'))

  const recargar = useCallback(() => {
    listarConversaciones()
      .then(setConversaciones)
      .catch(() => setConversaciones([]))
  }, [])

  useEffect(recargar, [recargar])
  // El próximo cambio de pantalla lo ha pedido el usuario: va a la historia (pushState). Lo consume escribirRuta.
  const apilar = useRef(false)
  useEffect(() => {
    escribirRuta(rutaDe(modo, activa, tipoNueva), apilar.current)
    apilar.current = false
  }, [modo, activa, tipoNueva])
  useEffect(() => {
    // Un enlace (#/…), Ctrl+K, o Atrás y Adelante: la pantalla sigue a la ruta. Con pushState, Atrás dispara popstate
    // (y hashchange); los dos llegan aquí y dejan lo mismo.
    const alCambiar = () => {
      const r = leerRuta(window.location.hash)
      // «Crear mi plan» (Hoy, tutor, foco, Ctrl+K) llega aquí: abre el cuestionario del plan, no el chat libre.
      if (r.nuevoPlan) setTipoNueva('plan')
      else if (r.modo === 'libre' && r.conversacion == null) setTipoNueva('libre')
      apilar.current = false
      setModo(r.modo)
      setActiva(r.conversacion)
    }
    window.addEventListener('hashchange', alCambiar)
    window.addEventListener('popstate', alCambiar)
    return () => {
      window.removeEventListener('hashchange', alCambiar)
      window.removeEventListener('popstate', alCambiar)
    }
  }, [])
  // Ir a una pantalla porque lo has elegido tú.
  const irA = useCallback((m: IdModo) => {
    apilar.current = true
    if (m === 'libre') {
      // Estudio libre desde la barra o el riel: el chat, no el cuestionario del plan que tuvieras abierto.
      setActiva(null)
      setTipoNueva('libre')
    }
    setModo(m)
  }, [])

  const actual = conversaciones.find((c) => c.id === activa)
  const tipo: 'libre' | 'plan' = actual ? (actual.tipo === 'plan' ? 'plan' : 'libre') : tipoNueva

  return (
    <div
      className={`marco ${menu ? 'menu-abierto' : ''} ${fija ? 'lateral-fija' : ''}`}
      data-seccion={claveSeccion(grupoDe(modo))}
      style={variables(acentoDe(colores, null))}
    >
      {/* El primer Tab: al contenido, sin pasar por el riel ni la cabecera. Un botón (no un enlace #…: la ruta es la app). */}
      <button
        type="button"
        className="saltar-contenido"
        onClick={() => document.querySelector<HTMLElement>('main.central')?.focus()}
      >
        Saltar al contenido
      </button>
      <div className="velo-menu" onClick={() => setMenu(false)} aria-hidden />
      <Riel modo={modo} hoy={hoy} alAbrir={() => setMenu(true)} alIr={irA} />
      <BarraLateral
        alCerrar={() => setMenu(false)}
        fija={fija}
        alFijar={fijar}
        oculta={!menu && !fija}
        modoActivo={modo}
        alElegir={(m) => {
          // Aunque ya estés en ese modo (p. ej. «Magister» desde Estudio libre), la barra se pliega.
          setMenu(false)
          irA(m)
        }}
        conversaciones={conversaciones}
        activa={activa}
        alElegirConversacion={(id) => {
          apilar.current = true
          setActiva(id)
          if (id == null) setTipoNueva('libre')
          setModo('libre')
        }}
        alCambiar={recargar}
      />
      <BarraSesion alMenu={() => setMenu(!menu)} />
      <Paleta conversaciones={conversaciones} alPlegar={() => setMenu((x) => !x)} />
      <main className="central" tabIndex={-1}>
        <Central
          modo={modo}
          conversacionId={activa}
          tipoConversacion={tipo}
          alCrearConversacion={(id) => {
            // La conversación nueva sustituye a «#/libre» (o a «#/nuevo-plan»): Atrás no vuelve a la caja vacía.
            apilar.current = false
            setActiva(id)
            recargar()
          }}
          alCambiarConversaciones={recargar}
          irA={irA}
          alNuevoPlan={() => {
            apilar.current = true
            setActiva(null)
            setTipoNueva('plan')
            setModo('libre')
          }}
        />
      </main>
      <Asesor />
      {bienvenida && <Bienvenida {...bienvenida} alCerrar={() => setBienvenida(null)} />}
    </div>
  )
}
