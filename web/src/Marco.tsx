import { useCallback, useEffect, useState } from 'react'
import { listarConversaciones, type Conversacion } from './api.ts'
import BarraLateral from './BarraLateral.tsx'
import BarraSesion from './BarraSesion.tsx'
import Riel, { pendienteDeHoy, usarHoy } from './Riel.tsx'
import Paleta from './componentes/Paleta.tsx'
import { avisosActivos } from './componentes/Afinar.tsx'
import { avisar } from './componentes/pomodoro.ts'
import { acentoDe, sincronizarAcento, usarColores, variables } from './componentes/colores.ts'
import Central from './Central.tsx'
import { MODOS, type IdModo } from './modos.ts'

// El modo y la conversación viajan en la URL (#/roadmap, #/conversacion/6):
// recargar no te saca de donde estabas y se puede enlazar una vista.
function leerRuta(): { modo: IdModo; conversacion: number | null } {
  const partes = window.location.hash.replace(/^#\/?/, '').split('/')
  if (partes[0] === 'conversacion' && Number(partes[1])) return { modo: 'libre', conversacion: Number(partes[1]) }
  const modo = MODOS.find((m) => m.id === partes[0] && m.encendido)?.id
  // Sin ruta se abre el tutor, que te recibe con lo que toca.
  return { modo: modo ?? (partes[0] ? 'libre' : 'tutor'), conversacion: null }
}

function escribirRuta(modo: IdModo, conversacion: number | null) {
  const ruta = modo === 'libre' && conversacion != null ? `#/conversacion/${conversacion}` : `#/${modo}`
  // #/fichas/3/L2 lleva a una lección: el panel lo lee y luego limpia la ruta.
  if (window.location.hash !== ruta && !window.location.hash.startsWith(`${ruta}/`))
    window.history.replaceState(null, '', ruta)
}

// Tres zonas: la barra lateral y la barra de sesión no cambian;
// la zona central recibe el modo activo y pinta lo suyo.
export default function Marco() {
  const inicial = leerRuta()
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
    const fecha = new Date().toISOString().slice(0, 10)
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
  const [tipoNueva, setTipoNueva] = useState<'libre' | 'plan'>(() =>
    window.location.hash.startsWith('#/nuevo-plan') ? 'plan' : 'libre',
  )

  const recargar = useCallback(() => {
    listarConversaciones()
      .then(setConversaciones)
      .catch(() => setConversaciones([]))
  }, [])

  useEffect(recargar, [recargar])
  useEffect(() => escribirRuta(modo, activa), [modo, activa])
  useEffect(() => {
    const alCambiar = () => {
      const r = leerRuta()
      setModo(r.modo)
      setActiva(r.conversacion)
    }
    window.addEventListener('hashchange', alCambiar)
    return () => window.removeEventListener('hashchange', alCambiar)
  }, [])

  const actual = conversaciones.find((c) => c.id === activa)
  const tipo: 'libre' | 'plan' = actual ? (actual.tipo === 'plan' ? 'plan' : 'libre') : tipoNueva

  return (
    <div className={`marco ${menu ? 'menu-abierto' : ''} ${fija ? 'lateral-fija' : ''}`} style={variables(acentoDe(colores, null))}>
      <div className="velo-menu" onClick={() => setMenu(false)} aria-hidden />
      <Riel modo={modo} hoy={hoy} alAbrir={() => setMenu(true)} alIr={(m) => setModo(m)} />
      <BarraLateral
        alCerrar={() => setMenu(false)}
        fija={fija}
        alFijar={fijar}
        oculta={!menu && !fija}
        modoActivo={modo}
        alElegir={(m) => {
          if (m === 'libre') {
            setActiva(null)
            setTipoNueva('libre')
          }
          setModo(m)
        }}
        conversaciones={conversaciones}
        activa={activa}
        alElegirConversacion={(id) => {
          setActiva(id)
          if (id == null) setTipoNueva('libre')
          setModo('libre')
        }}
        alCambiar={recargar}
      />
      <BarraSesion alMenu={() => setMenu(!menu)} />
      <Paleta conversaciones={conversaciones} alPlegar={() => setMenu((x) => !x)} />
      <main className="central">
        <Central
          modo={modo}
          conversacionId={activa}
          tipoConversacion={tipo}
          alCrearConversacion={(id) => {
            setActiva(id)
            recargar()
          }}
          alCambiarConversaciones={recargar}
          irA={setModo}
          alNuevoPlan={() => {
            setActiva(null)
            setTipoNueva('plan')
            setModo('libre')
          }}
        />
      </main>
    </div>
  )
}
