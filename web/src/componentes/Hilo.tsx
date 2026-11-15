import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { CitaInfo } from '../api.ts'
import { conMarcas, PanelCita } from '../Cita.tsx'

export interface Burbuja {
  clave: string
  rol: 'usuario' | 'tutor'
  contenido: string
  estado: 'completo' | 'interrumpido' | 'error' | 'llegando'
  tiempos?: { primero: number | null; total: number }
  citas?: CitaInfo[]
}

interface Props {
  burbujas: Burbuja[]
  escribiendo: boolean
  alEnviar: (texto: string) => void
  alParar: () => void
  placeholder?: string
  pie?: ReactNode
  deshabilitado?: boolean
}

// El hilo de una conversación: lo usan Estudio libre, el diagnóstico y la sesión de tutor.
export default function Hilo({ burbujas, escribiendo, alEnviar, alParar, placeholder, pie, deshabilitado }: Props) {
  const [borrador, setBorrador] = useState('')
  const caja = useRef<HTMLTextAreaElement>(null)
  const final = useRef<HTMLDivElement>(null)
  const [cita, setCita] = useState<{ id: number; info?: CitaInfo } | null>(null)

  useEffect(() => {
    final.current?.scrollIntoView({ block: 'end' })
  }, [burbujas])

  const mandar = () => {
    const texto = borrador.trim()
    if (!texto || escribiendo || deshabilitado) return
    setBorrador('')
    alEnviar(texto)
    caja.current?.focus()
  }

  const alTeclear = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      mandar()
    }
  }

  return (
    <div className="hilo">
      <div className="mensajes" aria-live="polite" aria-busy={escribiendo}>
        {burbujas.map((b) => (
          <div key={b.clave} className={`burbuja burbuja-${b.rol} burbuja-${b.estado}`}>
            {b.rol === 'tutor' && b.estado === 'llegando' && !b.contenido ? (
              <span className="puntos" aria-label="El tutor está escribiendo">
                …
              </span>
            ) : b.estado === 'error' ? (
              <p role="alert">{b.contenido}</p>
            ) : b.rol === 'tutor' ? (
              <Markdown
                remarkPlugins={[remarkGfm]}
                components={{
                  a: ({ href, children }) => {
                    const m = href?.match(/^#cita-(\d+)$/)
                    if (!m) return <a href={href} target="_blank" rel="noreferrer">{children}</a>
                    const id = Number(m[1])
                    const info = b.citas?.find((c) => c.fragmento_id === id)
                    return (
                      <button
                        type="button"
                        className={info?.dudosa ? 'marca-cita cita-dudosa' : 'marca-cita'}
                        title={info?.dudosa ? 'Cita dudosa: compruébala' : 'Ver la fuente'}
                        onClick={() => setCita({ id, info })}
                      >
                        {id}
                        {info?.dudosa ? '?' : ''}
                      </button>
                    )
                  },
                }}
              >
                {conMarcas(b.contenido)}
              </Markdown>
            ) : (
              <p className="propio">{b.contenido}</p>
            )}
            {b.estado === 'interrumpido' && <small className="nota">Interrumpido</small>}
            {b.tiempos && (
              <small className="nota">
                primer trozo {b.tiempos.primero ?? '·'} ms · total {b.tiempos.total} ms
              </small>
            )}
          </div>
        ))}
        <div ref={final} />
      </div>
      {cita && <PanelCita id={cita.id} info={cita.info} alCerrar={() => setCita(null)} />}
      {pie}
      <form
        className="entrada entrada-hilo"
        onSubmit={(e) => {
          e.preventDefault()
          mandar()
        }}
      >
        <textarea
          ref={caja}
          rows={2}
          value={borrador}
          onChange={(e) => setBorrador(e.target.value)}
          onKeyDown={alTeclear}
          placeholder={placeholder ?? 'Escribe tu mensaje (Mayúsculas + Intro para saltar de línea)'}
          aria-label="Tu mensaje"
          disabled={deshabilitado}
        />
        {escribiendo ? (
          <button type="button" className="boton" onClick={alParar}>
            Parar
          </button>
        ) : (
          <button type="submit" className="boton boton-principal" disabled={!borrador.trim() || deshabilitado}>
            Enviar
          </button>
        )}
      </form>
    </div>
  )
}
