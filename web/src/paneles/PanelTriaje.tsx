import { useCallback, useEffect, useState } from 'react'
import { enviarJson, pedir } from '../api.ts'

interface Candidato {
  id: number
  traza_id: string
  origen: string
  entrada: string
  salida: string
  nota: string | null
}

const BANCOS = ['tono', 'corrector', 'rag', 'plan']

// Triaje: las respuestas que valoraste mal o que suspendió el juez, para convertirlas en casos del banco.
export default function PanelTriaje() {
  const [lista, setLista] = useState<Candidato[]>([])
  const [banco, setBanco] = useState('tono')
  const [buena, setBuena] = useState<Record<number, string>>({})

  const cargar = useCallback(() => {
    pedir<Candidato[]>('/api/candidatos').then(setLista)
  }, [])
  useEffect(cargar, [cargar])

  const decidir = async (c: Candidato, accion: 'aceptar' | 'descartar') => {
    await pedir(
      `/api/candidatos/${c.id}`,
      enviarJson({ accion, banco: accion === 'aceptar' ? banco : null, respuesta_buena: buena[c.id] ?? null }),
    )
    cargar()
  }

  return (
    <div className="panel">
      <h1>Triaje del banco</h1>
      <p className="nota">
        Respuestas que valoraste con el pulgar abajo o que suspendió el juez online. Aceptar escribe el caso en{' '}
        <code>servidor/evals/banco/&lt;banco&gt;/</code>.
      </p>
      <label className="nota">
        Banco destino{' '}
        <select value={banco} onChange={(e) => setBanco(e.target.value)}>
          {BANCOS.map((b) => (
            <option key={b}>{b}</option>
          ))}
        </select>
      </label>
      {lista.length === 0 && <p className="vacio">No hay candidatos pendientes.</p>}
      {lista.map((c) => (
        <section key={c.id} className="propuesta">
          <p className="nota">
            {c.origen} · traza {c.traza_id}
            {c.nota ? ` · ${c.nota}` : ''}
          </p>
          {c.salida && <pre className="texto-fragmento">{c.salida.slice(-1200)}</pre>}
          <textarea
            className="critica"
            placeholder="La respuesta buena (opcional)"
            value={buena[c.id] ?? ''}
            onChange={(e) => setBuena({ ...buena, [c.id]: e.target.value })}
          />
          <div className="botones">
            <button className="boton boton-principal" onClick={() => decidir(c, 'aceptar')}>
              Aceptar al banco
            </button>
            <button className="boton" onClick={() => decidir(c, 'descartar')}>
              Descartar
            </button>
          </div>
        </section>
      ))}
    </div>
  )
}
