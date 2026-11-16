import { useEffect, useRef, useState } from 'react'
import { ACENTOS, acentoDe, usarColores } from './colores.ts'

// El botón «Acento»: unos pocos colores para elegir, o uno distinto por lección.
export default function Colores({ leccion, clase = 'boton' }: { leccion?: string | null; clase?: string }) {
  const [ajuste, guardar] = usarColores()
  const [abierto, setAbierto] = useState(false)
  const caja = useRef<HTMLDivElement | null>(null)
  const actual = acentoDe(ajuste, leccion)

  useEffect(() => {
    if (!abierto) return
    const fuera = (e: MouseEvent) => {
      if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false)
    }
    document.addEventListener('mousedown', fuera)
    return () => document.removeEventListener('mousedown', fuera)
  }, [abierto])

  return (
    <div className="colores" ref={caja}>
      <button type="button" className={clase} aria-expanded={abierto} onClick={() => setAbierto(!abierto)}>
        <span className="colores-muestra" style={{ background: actual.color }} /> Acento
      </button>
      {abierto && (
        <div className="colores-caja" role="dialog" aria-label="Color de acento">
          <div className="colores-acentos" role="radiogroup" aria-label="Acento">
            {ACENTOS.map((a) => (
              <button
                key={a.id}
                type="button"
                role="radio"
                aria-checked={ajuste.modo === 'fijo' && ajuste.acento === a.id}
                className="colores-acento"
                style={{ background: a.color }}
                title={a.nombre}
                aria-label={a.nombre}
                onClick={() => guardar({ modo: 'fijo', acento: a.id })}
              />
            ))}
          </div>
          <label className="colores-auto">
            <input
              type="checkbox"
              checked={ajuste.modo === 'auto'}
              onChange={(e) => guardar({ ...ajuste, modo: e.target.checked ? 'auto' : 'fijo' })}
            />
            Uno distinto en cada lección
          </label>
        </div>
      )}
    </div>
  )
}
