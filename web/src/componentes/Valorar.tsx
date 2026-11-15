import { useState } from 'react'
import { enviarJson, pedir } from '../api.ts'

interface Props {
  traza: string
  inicial: boolean | null
  alPedirOtra?: (texto: string) => void
}

// Me sirve o no me sirve, junto a cada respuesta. «No me sirve» pide qué falla y puede pedir otra explicación.
export default function Valorar({ traza, inicial, alPedirOtra }: Props) {
  const [voto, setVoto] = useState<boolean | null>(inicial)
  const [abierto, setAbierto] = useState(false)
  const [comentario, setComentario] = useState('')
  const [hecho, setHecho] = useState(false)

  const votar = async (bien: boolean, otra = false) => {
    await pedir(`/api/trazas/${traza}/feedback`, enviarJson({ bien, comentario: comentario.trim() || null, otra }))
    setVoto(bien)
    setAbierto(false)
    setHecho(true)
    if (otra && alPedirOtra)
      alPedirOtra(
        `Esa explicación no me ha servido${comentario.trim() ? `: ${comentario.trim()}` : ''}. Explícamelo de otra forma.`,
      )
  }

  return (
    <div className="valorar">
      <button className={`voto voto-bien ${voto === true ? 'votado' : ''}`} aria-pressed={voto === true} onClick={() => votar(true)}>
        ✓ Me sirve
      </button>
      <button
        className={`voto voto-mal ${voto === false ? 'votado' : ''}`}
        aria-pressed={voto === false}
        onClick={() => setAbierto(!abierto)}
      >
        ✗ No me sirve
      </button>
      {hecho && !abierto && <span className="nota">Anotado, gracias.</span>}
      {abierto && (
        <div className="valorar-caja">
          <textarea
            autoFocus
            placeholder="¿Qué ha fallado? (opcional: demasiado largo, no entiendo X, falta un ejemplo...)"
            aria-label="Qué ha fallado"
            value={comentario}
            onChange={(e) => setComentario(e.target.value)}
          />
          <div className="botones">
            <button className="boton" onClick={() => votar(false)}>
              Enviar
            </button>
            {alPedirOtra && (
              <button className="boton boton-principal" onClick={() => votar(false, true)}>
                Enviar y pedir otra explicación
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
