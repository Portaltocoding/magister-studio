// Lo que Magister ha aprendido de tus valoraciones: las reglas que ya aplica al generar (se pueden quitar) y cuánto
// tiene que revisar todavía. Cuanto mejor te conoce, menos revisa, y menos gasta de tu sesión.
import { useEffect, useState } from 'react'
import { pedir } from '../api.ts'

interface Afinado {
  revisa: number
  dimensiones: { id: string; nombre: string; confianza: number }[]
  reglas: { motivo: string | null; texto: string }[]
  juzgadas: number
  saltadas: number
}

export default function Aprendido() {
  const [a, setA] = useState<Afinado | null>(null)
  useEffect(() => {
    pedir<Afinado>('/api/afinado').then(setA).catch(() => undefined)
  }, [])
  if (!a) return null
  const deDiez = Math.max(1, Math.round(a.revisa * 10))
  return (
    <div className="afinar-grupo aprendido">
      <span>Lo que ha aprendido de tus valoraciones</span>
      {a.reglas.length ? (
        <ul className="afinar-recuerda">
          {a.reglas.map((r) => (
            <li key={r.texto}>
              <span>{r.texto}</span>
              {r.motivo && (
                <button
                  className="borrar"
                  aria-label="Que no lo aplique"
                  title="Que no lo aplique"
                  onClick={() => pedir<Afinado>(`/api/afinado/reglas/${r.motivo}/quitar`, { method: 'POST' }).then(setA)}
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="nota">Nada aún. Cuando algo no te sirva, dile por qué («muy largo», «le falta un ejemplo») y lo aplicará.</p>
      )}
      <p className="nota aprendido-revisa">
        Revisa {deDiez === 10 ? 'todo' : `${deDiez} de cada 10`} de lo que genera.{' '}
        {deDiez > 2 ? 'Cuanto más le valores, mejor te conoce y menos tiene que revisar.' : 'Ya te conoce: revisa poco y gasta menos.'}
      </p>
    </div>
  )
}
