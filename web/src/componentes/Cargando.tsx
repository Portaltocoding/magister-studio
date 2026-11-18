import { useEffect, useState } from 'react'

// Lo que se ve mientras una pantalla carga sus datos. Nunca se queda en «Preparando…» para siempre:
// si la carga falla dice por qué, ofrece «Reintentar» y lo reintenta solo cuando el servidor vuelve
// (la barra de arriba avisa con EVENTO_CONECTADO) o, mientras tanto, cada pocos segundos.

export const EVENTO_CONECTADO = 'magister-conectado'
const CADA_MS = 6000
const MAX_AUTOMATICOS = 10

export const mensajeDe = (e: unknown) => (e instanceof Error ? e.message : String(e))

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

  if (error)
    return (
      <div className="cargando-fallo" role="alert">
        <p>No he podido cargar esta pantalla. {error}</p>
        {reintentar && (
          <button type="button" className="boton" onClick={reintentar}>
            Reintentar
          </button>
        )}
      </div>
    )
  return (
    <p className="vacio" aria-busy="true">
      {texto}
      {lento && ' Está tardando más de lo normal.'}
    </p>
  )
}
