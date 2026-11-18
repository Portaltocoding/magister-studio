import { useState } from 'react'
import { enviarJson, pedir } from '../api.ts'

// Por qué no sirve: cada motivo afina lo que Magister aprende de ti (servidor: tono/confianza.py, MOTIVOS).
const MOTIVOS: [string, string][] = [
  ['largo', 'Muy largo'],
  ['corto', 'Se queda corto'],
  ['basico', 'Muy básico'],
  ['tecnico', 'Mucha jerga'],
  ['sin_ejemplo', 'Le falta un ejemplo'],
  ['confuso', 'Me he perdido'],
  ['error', 'Hay un error'],
  ['tono', 'El tono'],
]

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
  const [motivos, setMotivos] = useState<string[]>([])
  const [hecho, setHecho] = useState(false)

  const votar = async (bien: boolean, otra = false) => {
    await pedir(`/api/trazas/${traza}/feedback`, enviarJson({ bien, comentario: comentario.trim() || null, otra, motivos: bien ? [] : motivos }))
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
          <div className="valorar-motivos" role="group" aria-label="Qué ha fallado">
            {MOTIVOS.map(([id, nombre]) => (
              <button
                key={id}
                type="button"
                className={`opcion-chip ${motivos.includes(id) ? 'elegida' : ''}`}
                aria-pressed={motivos.includes(id)}
                onClick={() => setMotivos(motivos.includes(id) ? motivos.filter((m) => m !== id) : [...motivos, id])}
              >
                {nombre}
              </button>
            ))}
          </div>
          <textarea
            autoFocus
            placeholder="Algo más que quieras decirle (opcional)"
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
