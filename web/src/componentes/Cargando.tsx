import { useEffect, useState } from 'react'
import { errorLegible } from './errores.ts'

// Lo que se ve mientras una pantalla carga sus datos. Nunca se queda en «Preparando…» para siempre:
// si la carga falla dice por qué, ofrece «Reintentar» y lo reintenta solo cuando el servidor vuelve
// (la barra de arriba avisa con EVENTO_CONECTADO) o, mientras tanto, cada pocos segundos.

export const EVENTO_CONECTADO = 'magister-conectado'
const CADA_MS = 6000
const MAX_AUTOMATICOS = 10

export const mensajeDe = (e: unknown) => (e instanceof Error ? e.message : String(e))

export const mayuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)

// El original de un fallo traducido, plegado para poder copiarlo.
export function DetalleTecnico({ detalle }: { detalle: string | null }) {
  if (!detalle) return null
  return (
    <details className="nota">
      <summary>Detalle técnico</summary>
      <code style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', userSelect: 'all' }}>{detalle}</code>
    </details>
  )
}

// Un fallo (o un aviso que puede serlo) a la vista: la frase legible y, si venía en crudo, el detalle técnico.
export function TextoError({
  texto,
  antes = '',
  rol = 'alert',
  className,
}: {
  texto: string | null | undefined
  antes?: string
  rol?: 'alert' | 'status'
  className?: string
}) {
  const { mensaje, detalle } = errorLegible(texto)
  return (
    <div role={rol}>
      <p className={className}>
        {antes}
        {antes ? mayuscula(mensaje) : mensaje}
      </p>
      <DetalleTecnico detalle={detalle} />
    </div>
  )
}

export default function Cargando({
  texto = 'Cargando…',
  error,
  reintentar,
}: {
  texto?: string
  error?: string | null
  reintentar?: () => void
}) {
  const [lento, setLento] = useState(false)
  useEffect(() => {
    if (error) return
    const t = setTimeout(() => setLento(true), 8000)
    return () => clearTimeout(t)
  }, [error])

  useEffect(() => {
    if (!error || !reintentar) return
    let veces = 0
    const otra = () => {
      if (document.visibilityState !== 'visible' || veces >= MAX_AUTOMATICOS) return
      veces++
      reintentar()
    }
    const t = setInterval(otra, CADA_MS)
    window.addEventListener(EVENTO_CONECTADO, reintentar)
    return () => {
      clearInterval(t)
      window.removeEventListener(EVENTO_CONECTADO, reintentar)
    }
  }, [error, reintentar])

  if (error) {
    const { mensaje, detalle } = errorLegible(error)
    return (
      <div className="cargando-fallo" role="alert">
        <p>No he podido cargar esta pantalla. {mayuscula(mensaje)}</p>
        <DetalleTecnico detalle={detalle} />
        {reintentar && (
          <button type="button" className="boton" onClick={reintentar}>
            Reintentar
          </button>
        )}
      </div>
    )
  }
  return (
    <p className="vacio" aria-busy="true">
      {texto}
      {lento && ' Está tardando más de lo normal.'}
    </p>
  )
}
