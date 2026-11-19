import { useEffect, useRef, useState } from 'react'
import { mmss, usarPomodoro } from './pomodoro.ts'

// El pomodoro: un tomate junto a la mascota. Pulsas, eliges el ritmo y la cuenta atrás se queda al lado.

function IconoTomate({ fase }: { fase: 'foco' | 'descanso' | null }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden className={`tomate-icono ${fase ? `fase-${fase}` : ''}`}>
      <path className="tomate-cuerpo" d="M12 6.2c4.6 0 8 2.9 8 7.1 0 4.3-3.6 7.2-8 7.2s-8-2.9-8-7.2c0-4.2 3.4-7.1 8-7.1z" />
      <path className="tomate-hoja" d="M12 7.2c-.6-1.4-2-2.1-3.6-1.8 1 .5 1.7 1.2 2 2.1-1.5-.4-3-.1-4 .9 1.6.1 3 .6 3.9 1.4M12 7.2c.6-1.4 2-2.1 3.6-1.8-1 .5-1.7 1.2-2 2.1 1.5-.4 3-.1 4 .9-1.6.1-3 .6-3.9 1.4M12 7.2V4" />
    </svg>
  )
}

const RITMOS: [number, number][] = [
  [25, 5],
  [50, 10],
  [15, 3],
]

export default function Tomate() {
  const pomo = usarPomodoro(true)
  const [abierto, setAbierto] = useState(false)
  const caja = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!abierto) return
    const fuera = (e: MouseEvent) => caja.current && !caja.current.contains(e.target as Node) && setAbierto(false)
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && setAbierto(false)
    document.addEventListener('mousedown', fuera)
    document.addEventListener('keydown', tecla)
    return () => {
      document.removeEventListener('mousedown', fuera)
      document.removeEventListener('keydown', tecla)
    }
  }, [abierto])

  const fase = pomo.p.fase
  return (
    <div className="tomate" ref={caja}>
      <button
        type="button"
        className={`tomate-boton ${fase ? `fase-${fase}` : ''} ${fase && !pomo.p.fin ? 'pausado' : ''}`}
        onClick={() => setAbierto(!abierto)}
        aria-label="Pomodoro"
        title={fase ? `Pomodoro: ${fase === 'foco' ? 'foco' : 'descanso'}` : 'Pomodoro'}
      >
        <IconoTomate fase={fase} />
        {fase && <span className="tomate-tiempo">{mmss(pomo.quedan)}</span>}
      </button>
      {abierto && (
        <div className="tomate-caja" role="dialog" aria-label="Pomodoro">
          <strong>Pomodoro</strong>
          <p className="nota">
            {fase
              ? `${fase === 'foco' ? 'Foco' : 'Descanso'}: quedan ${mmss(pomo.quedan)}.`
              : 'Un rato de foco y un descanso corto. Te aviso al cambiar.'}
            {pomo.p.rondas ? ` Hoy llevas ${pomo.p.rondas}.` : ''}
          </p>
          {fase ? (
            <div className="botones">
              {pomo.p.fin ? (
                <button type="button" className="boton" onClick={pomo.pausar}>
                  Pausa
                </button>
              ) : (
                <button type="button" className="boton boton-principal" onClick={pomo.seguir}>
                  Seguir
                </button>
              )}
              <button type="button" className="boton" onClick={pomo.parar}>
                Parar
              </button>
            </div>
          ) : (
            <div className="tomate-ritmos">
              {RITMOS.map(([f, d]) => (
                <button
                  key={f}
                  type="button"
                  className="opcion"
                  onClick={() => {
                    pomo.empezar(f, d)
                    setAbierto(false)
                  }}
                >
                  <strong>{f} min</strong>
                  <small>+ {d} de descanso</small>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
