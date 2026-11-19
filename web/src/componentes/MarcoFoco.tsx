import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import Colores from './Colores.tsx'
import { acentoDe, usarColores, variables } from './colores.ts'

interface Props {
  titulo: string
  // L3, «Examen», «Repaso»: lo que va en la placa de la izquierda.
  placa?: string | null
  // La lección, para su paleta cuando los colores van en automático.
  leccion?: string | null
  pasos?: ReactNode
  reloj?: ReactNode
  herramientas?: ReactNode
  // Lo que va dentro de «Ajustes ▾» además de atenuar, colores y pantalla completa (por ejemplo, el ritmo).
  ajustes?: ReactNode
  aviso?: ReactNode
  pie?: ReactNode
  lateral?: ReactNode
  // Teclas propias de cada uso. Devuelve true si la ha usado (Esc incluida).
  teclas?: (e: KeyboardEvent, ctx: { menuAbierto: boolean }) => boolean
  // La zona que se desplaza, para quien la necesite (el párrafo activo de una lección).
  alCuerpo?: (el: HTMLDivElement | null) => void
  alSalir: () => void
  children: ReactNode
}

// «Atenuar lo demás»: se guarda con la clave de la antigua lupa, con el mismo significado (encendido por defecto).
function usarAtenuar(): [boolean, (v: boolean | ((x: boolean) => boolean)) => void] {
  const [atenuar, setAtenuar] = useState(() => {
    try {
      return localStorage.getItem('magister-lupa') !== 'no'
    } catch {
      return true
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem('magister-lupa', atenuar ? 'si' : 'no')
    } catch {
      /* sin almacenamiento: vale para esta sesión */
    }
  }, [atenuar])
  return [atenuar, setAtenuar]
}

const CAMPO = 'textarea, input, select, [contenteditable]:not([contenteditable="false"])'
const ENFOCABLES =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

// Modo foco: pantalla completa, sin menús, con atenuado y colores. Vale para una lección, el repaso o un examen.
// Se pinta fuera de la app (en <body>) y la app de detrás queda inerte: el Tab no se escapa.
export default function MarcoFoco(p: Props) {
  const [atenuar, setAtenuar] = usarAtenuar()
  const [pantalla, setPantalla] = useState(!!document.fullscreenElement)
  const [ajuste] = usarColores()
  const [menu, setMenu] = useState(false)
  const caja = useRef<HTMLSpanElement | null>(null)
  const botonAjustes = useRef<HTMLButtonElement | null>(null)
  const cuerpo = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!menu) return
    const fuera = (e: MouseEvent) => caja.current && !caja.current.contains(e.target as Node) && setMenu(false)
    document.addEventListener('mousedown', fuera)
    return () => document.removeEventListener('mousedown', fuera)
  }, [menu])
  const { alSalir, teclas, alCuerpo } = p

  const salir = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined)
    alSalir()
  }, [alSalir])

  useEffect(() => {
    const cambio = () => setPantalla(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', cambio)
    document.body.classList.add('en-foco')
    return () => {
      document.removeEventListener('fullscreenchange', cambio)
      document.body.classList.remove('en-foco')
    }
  }, [])

  // Al entrar: la app de detrás, inerte, y el foco en la zona de lectura (así AvPág y la rueda van sin clic).
  // Al salir, el foco vuelve a donde estaba (el botón con el que entraste).
  useLayoutEffect(() => {
    const antes = document.activeElement as HTMLElement | null
    const raiz = document.getElementById('root')
    raiz?.setAttribute('inert', '')
    const c = cuerpo.current
    if (c && !c.contains(document.activeElement)) c.focus({ preventScroll: true })
    return () => {
      raiz?.removeAttribute('inert')
      if (antes && antes.isConnected && antes !== document.body) antes.focus({ preventScroll: true })
    }
  }, [])

  const refCuerpo = useCallback(
    (el: HTMLDivElement | null) => {
      cuerpo.current = el
      alCuerpo?.(el)
    },
    [alCuerpo],
  )

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      // Tab da la vuelta dentro del foco: del último control al primero (y al revés con Mayús).
      if (e.key === 'Tab' && !e.altKey && !e.ctrlKey && !e.metaKey) {
        const raiz = cuerpo.current?.closest('.foco')
        const lista = raiz ? Array.from(raiz.querySelectorAll<HTMLElement>(ENFOCABLES)).filter((x) => x.getClientRects().length > 0) : []
        const a = document.activeElement as HTMLElement | null
        const fuera = !a || !raiz?.contains(a)
        if (lista.length && (fuera || (e.shiftKey ? a === lista[0] : a === lista[lista.length - 1]))) {
          e.preventDefault()
          ;(e.shiftKey ? lista[lista.length - 1] : lista[0]).focus()
        }
        return
      }
      // Escribiendo, las teclas son del texto: solo Esc, que sale del campo (y el foco vuelve a la zona de lectura).
      const campo = (e.target as HTMLElement | null)?.closest?.(CAMPO) as HTMLElement | null
      if (campo) {
        if (e.key === 'Escape' && !e.defaultPrevented) {
          e.preventDefault()
          campo.blur()
          if (cuerpo.current?.contains(campo)) cuerpo.current.focus({ preventScroll: true })
        }
        return
      }
      // Con Ctrl, Cmd o Alt, son del navegador.
      if (e.ctrlKey || e.metaKey || e.altKey) return
      // Ya la ha usado alguien (el bocadillo de la mascota, un menú).
      if (e.defaultPrevented) return
      if (e.key === 'Escape' && menu) {
        e.preventDefault()
        setMenu(false)
        botonAjustes.current?.focus()
        return
      }
      if (teclas?.(e, { menuAbierto: menu })) return
      if (e.key === 'Escape' && !document.fullscreenElement) salir()
      else if (e.key === 'l') setAtenuar((x) => !x)
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [teclas, salir, setAtenuar, menu])

  const pantallaCompleta = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined)
    else document.documentElement.requestFullscreen?.().catch(() => undefined)
  }

  return createPortal(
    <div
      className={`foco ${atenuar ? 'atenuar' : ''}`}
      style={variables(acentoDe(ajuste, p.leccion))}
      role="dialog"
      aria-modal="true"
      aria-label={`Modo foco: ${p.titulo}`}
    >
      <header className="foco-barra">
        <div className="foco-titulo">
          {p.placa && <span className="bloques-clave">{p.placa}</span>}
          <span className="recorte">{p.titulo}</span>
        </div>
        <div className="foco-centro">{p.pasos}</div>
        <div className="foco-herramientas">
          {p.reloj}
          {p.herramientas}
          {/* Lo de estudiar, a la vista; lo de ajustar la pantalla, en un menú. */}
          <span className="foco-ajustes" ref={caja}>
            <button ref={botonAjustes} className="foco-boton" aria-expanded={menu} onClick={() => setMenu(!menu)} title="Atenuar, colores, ritmo y pantalla completa">
              Ajustes ▾
            </button>
            {menu && (
              <span className="foco-ajustes-caja">
                <button className="foco-boton" aria-pressed={atenuar} onClick={() => setAtenuar(!atenuar)} title="Atenuar los párrafos que no estás leyendo (L)">
                  {atenuar ? '✓ ' : ''}Atenuar lo demás (L)
                </button>
                <Colores leccion={p.leccion} clase="foco-boton" />
                <button className="foco-boton" onClick={pantallaCompleta}>
                  {pantalla ? 'Salir de pantalla completa' : 'Pantalla completa'}
                </button>
                {p.ajustes}
              </span>
            )}
          </span>
          <button className="foco-boton foco-salir" onClick={salir} title="Salir (Esc)">
            Salir
          </button>
        </div>
      </header>
      {p.aviso}
      <div className="foco-cuerpo" ref={refCuerpo} tabIndex={-1}>
        {p.children}
      </div>
      {p.pie && <footer className="foco-pie">{p.pie}</footer>}
      {p.lateral}
    </div>,
    document.body,
  )
}

// La pantalla completa solo se puede pedir dentro de un clic: se llama al pulsar «Empezar».
export const pedirPantallaCompleta = () => document.documentElement.requestFullscreen?.().catch(() => undefined)

export const reloj = (s: number) => {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}
