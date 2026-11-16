import type { ReactNode } from 'react'

export interface Accion {
  texto: string
  alPulsar: () => void
  principal?: boolean
}

interface Props {
  // Una palabra encima del título: dónde estás («Repaso», «Lección 3»...).
  etiqueta?: string
  titulo: string
  texto: ReactNode
  // Qué va a pasar, en orden: así una pantalla vacía explica para qué sirve.
  pasos?: { titulo: string; texto: string }[]
  acciones?: Accion[]
  children?: ReactNode
}

// La pantalla antes de empezar: qué es esto, qué saldrá y el primer paso, siempre a un clic.
export default function Vacio({ etiqueta, titulo, texto, pasos, acciones, children }: Props) {
  return (
    <section className="vacio-guia">
      {etiqueta && <span className="vacio-etq">{etiqueta}</span>}
      <h2>{titulo}</h2>
      <p className="vacio-texto">{texto}</p>
      {pasos && pasos.length > 0 && (
        <ol className="vacio-pasos">
          {pasos.map((p, i) => (
            <li key={p.titulo}>
              <span className="vacio-num">{i + 1}</span>
              <strong>{p.titulo}</strong>
              <span>{p.texto}</span>
            </li>
          ))}
        </ol>
      )}
      {children}
      {acciones && acciones.length > 0 && (
        <div className="vacio-acciones">
          {acciones.map((a) => (
            <button key={a.texto} className={`boton ${a.principal ? 'boton-principal' : ''}`} onClick={a.alPulsar}>
              {a.texto}
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

// Para navegar a una vista (y a una lección) desde cualquier panel.
export const irARuta = (ruta: string) => {
  window.location.hash = ruta
}
