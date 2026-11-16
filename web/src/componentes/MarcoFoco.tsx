import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
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
  // Lo que va dentro de «Ajustes ▾» además de lupa, colores y pantalla completa (por ejemplo, el ritmo).
  ajustes?: ReactNode
  aviso?: ReactNode
  pie?: ReactNode
  lateral?: ReactNode
  // Teclas propias de cada uso. Devuelve true si la ha usado (Esc incluida).
  teclas?: (e: KeyboardEvent) => boolean
  alSalir: () => void
  children: ReactNode
}

function usarLupa(): [boolean, (v: boolean | ((x: boolean) => boolean)) => void] {
  const [lupa, setLupa] = useState(() => {
    try {
      return localStorage.getItem('magister-lupa') !== 'no'
    } catch {
      return true
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem('magister-lupa', lupa ? 'si' : 'no')
    } catch {
      /* sin almacenamiento: vale para esta sesión */
    }
  }, [lupa])
  return [lupa, setLupa]
}

// Modo foco: pantalla completa, sin menús, con lupa y colores. Vale para una lección, el repaso o un examen.
export default function MarcoFoco(p: Props) {
  const [lupa, setLupa] = usarLupa()
  const [pantalla, setPantalla] = useState(!!document.fullscreenElement)
  const [ajuste] = usarColores()
  const [menu, setMenu] = useState(false)
  const caja = useRef<HTMLSpanElement | null>(null)
  useEffect(() => {
    if (!menu) return
    const fuera = (e: MouseEvent) => caja.current && !caja.current.contains(e.target as Node) && setMenu(false)
    document.addEventListener('mousedown', fuera)
    return () => document.removeEventListener('mousedown', fuera)
  }, [menu])
  const { alSalir, teclas } = p

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

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      const escribiendo = (e.target as HTMLElement).closest('textarea, input, select')
      // Escribiendo, las teclas son del texto; con Alt pulsada, son del foco (Alt + → pasa de pregunta).
      if (escribiendo && !e.altKey) {
        if (e.key === 'Escape') (escribiendo as HTMLElement).blur()
        return
      }
      if (e.ctrlKey || e.metaKey) return
      if (teclas?.(e)) return
      if (e.key === 'Escape' && !document.fullscreenElement) salir()
      else if (e.key === 'l') setLupa((x) => !x)
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [teclas, salir, setLupa])

  const pantallaCompleta = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined)
    else document.documentElement.requestFullscreen?.().catch(() => undefined)
  }

  return (
    <div
      className={`foco ${lupa ? 'lupa' : ''}`}
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
            <button className="foco-boton" aria-expanded={menu} onClick={() => setMenu(!menu)} title="Lupa, colores, ritmo y pantalla completa">
              Ajustes ▾
            </button>
            {menu && (
              <span className="foco-ajustes-caja">
                <button className="foco-boton" aria-pressed={lupa} onClick={() => setLupa(!lupa)} title="Acercar el párrafo bajo el ratón (L)">
                  {lupa ? '✓ ' : ''}Lupa
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
      <div className="foco-cuerpo">{p.children}</div>
      {p.pie && <footer className="foco-pie">{p.pie}</footer>}
      {p.lateral}
    </div>
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
