import { useState } from 'react'
import { enviarJson, pedir } from '../api.ts'

// Pulgar arriba o abajo junto a cada respuesta, con comentario opcional (feedback_usuario de la traza).
export default function Valorar({ traza }: { traza: string }) {
  const [voto, setVoto] = useState<boolean | null>(null)

  const votar = async (bien: boolean) => {
    const comentario = bien ? null : window.prompt('¿Qué ha fallado? (opcional)') || null
    await pedir(`/api/trazas/${traza}/feedback`, enviarJson({ bien, comentario }))
    setVoto(bien)
  }

  return (
    <span className="valorar">
      <button aria-pressed={voto === true} aria-label="Buena respuesta" onClick={() => votar(true)}>
        bien
      </button>
      <button aria-pressed={voto === false} aria-label="Mala respuesta" onClick={() => votar(false)}>
        mal
      </button>
    </span>
  )
}
