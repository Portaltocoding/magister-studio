import { useCallback, useEffect, useState } from 'react'
import Markdown from 'react-markdown'
import { enviarJson, pedir } from '../api.ts'

interface Bloque {
  material_id: number
  clave: string
  texto: string
  dimensiones: string[]
  ronda: number
}

const NOMBRES: Record<string, string> = { razonamiento: 'Razonamiento', economia: 'Economía', trato: 'Trato' }

// Etiquetar el banco de tono: tu veredicto por dimensión, para calibrar el juez (Parte IV).
// Atajos: 1, 2, 3 cambian aprueba o suspende de cada dimensión; Intro guarda.
export default function PanelEtiquetar() {
  const [ronda, setRonda] = useState(1)
  const [bloque, setBloque] = useState<Bloque | null>(null)
  const [vacio, setVacio] = useState(false)
  const [notas, setNotas] = useState<Record<string, boolean>>({})
  const [critica, setCritica] = useState('')
  const [aviso, setAviso] = useState<string | null>(null)

  const siguiente = useCallback(() => {
    pedir<Bloque | null>(`/api/etiquetar/siguiente?ronda=${ronda}`).then((b) => {
      setBloque(b)
      setVacio(!b)
      setNotas(Object.fromEntries((b?.dimensiones ?? []).map((d) => [d, true])))
      setCritica('')
    })
  }, [ronda])

  useEffect(siguiente, [siguiente])

  const guardar = useCallback(async () => {
    if (!bloque) return
    for (const d of bloque.dimensiones)
      await pedir(
        '/api/etiquetas',
        enviarJson({ material_id: bloque.material_id, clave: bloque.clave, dimension: d, veredicto: notas[d], critica, ronda }),
      )
    siguiente()
  }, [bloque, notas, critica, ronda, siguiente])

  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      if (!bloque || (e.target as HTMLElement).tagName === 'TEXTAREA') return
      const i = Number(e.key) - 1
      if (i >= 0 && i < bloque.dimensiones.length) {
        const d = bloque.dimensiones[i]
        setNotas((n) => ({ ...n, [d]: !n[d] }))
      } else if (e.key === 'Enter') guardar()
    }
    window.addEventListener('keydown', alTeclear)
    return () => window.removeEventListener('keydown', alTeclear)
  }, [bloque, guardar])

  return (
    <div className="panel">
      <h1>Etiquetar el tono</h1>
      <p className="nota">
        Tus veredictos calibran al juez de tono (kappa). La rúbrica está en <code>docs/rubrica.md</code>. Cuando
        tengas bloques generados, reparte el banco una vez.
      </p>
      <div className="fila">
        <button
          className="boton-mini"
          onClick={() =>
            pedir<Record<string, number>>('/api/banco/repartir', { method: 'POST' })
              .then((r) => setAviso(`Banco repartido: ${r.alinear} alinear, ${r.validar} validar, ${r.reserva} reserva.`))
              .then(siguiente)
              .catch((e) => setAviso(e.message))
          }
        >
          Repartir el banco
        </button>
        <label>
          <input type="checkbox" checked={ronda === 2} onChange={(e) => setRonda(e.target.checked ? 2 : 1)} /> Segunda
          ronda (techo humano)
        </label>
      </div>
      {aviso && <p className="nota">{aviso}</p>}
      {vacio && <p className="vacio">No hay bloques por etiquetar en esta ronda.</p>}
      {bloque && (
        <>
          <div className="apuntes">
            <Markdown>{bloque.texto}</Markdown>
          </div>
          <div className="fila">
            {bloque.dimensiones.map((d, i) => (
              <button
                key={d}
                className={notas[d] ? 'boton' : 'boton cita-dudosa'}
                aria-pressed={notas[d]}
                onClick={() => setNotas({ ...notas, [d]: !notas[d] })}
              >
                {i + 1} · {NOMBRES[d] ?? d}: {notas[d] ? 'aprueba' : 'suspende'}
              </button>
            ))}
          </div>
          <textarea
            className="critica"
            placeholder="Crítica: qué reescribirías (opcional)"
            value={critica}
            onChange={(e) => setCritica(e.target.value)}
          />
          <button className="boton boton-principal" onClick={guardar}>
            Guardar y siguiente (Intro)
          </button>
        </>
      )}
    </div>
  )
}
