// Taller → Pronunciación: el glosario de cómo dice la voz cada término técnico. Se busca por cómo se escribe, cómo se
// dice o su grupo; cada término se escucha con la voz elegida, y una frase de prueba enseña lo que le llega a la voz.
// Para añadir o corregir un término: una línea en componentes/pronunciacion.ts.
import { useEffect, useMemo, useRef, useState } from 'react'
import { buscarTerminos, GLOSARIO } from '../componentes/pronunciacion.ts'
import { Locutor, pronunciar } from '../componentes/voz.ts'

const EJEMPLO = 'Con el índice, EXPLAIN ANALYZE dice Bitmap Index Scan sobre idx_pedidos_cliente: 0,078 ms en vez de 90 ms, y cada pedido tiene su id.'

export default function PanelPronunciacion() {
  const [consulta, setConsulta] = useState('')
  const [frase, setFrase] = useState(EJEMPLO)
  const locutor = useRef(new Locutor())
  useEffect(() => {
    const l = locutor.current
    return () => l.parar()
  }, [])

  const decir = (texto: string) => {
    const l = locutor.current
    l.nueva()
    l.decir(texto)
    l.cerrar()
  }

  const hallados = useMemo(() => buscarTerminos(consulta), [consulta])
  const grupos = useMemo(() => {
    const m = new Map<string, typeof hallados>()
    for (const t of hallados) m.set(t.grupo, [...(m.get(t.grupo) ?? []), t])
    return [...m.entries()]
  }, [hallados])

  return (
    <div className="panel pronunciacion">
      <div className="cabecera-panel">
        <h1>Pronunciación</h1>
      </div>
      <p className="nota">
        Cómo dice la voz cada término técnico (escrito, una voz española deletrea las siglas: «id» sonaría «i de»). Lo usan el
        vídeo, la llamada y Hablar; la pantalla y los subtítulos siguen con lo escrito. Para añadir uno, una línea en{' '}
        <code>componentes/pronunciacion.ts</code>.
      </p>

      <section className="pronunciacion-prueba tarjeta">
        <label htmlFor="frase-prueba">Prueba una frase</label>
        <textarea id="frase-prueba" rows={2} value={frase} onChange={(e) => setFrase(e.target.value)} />
        <p className="nota">
          La voz recibe: <span className="pronunciacion-dicho">{pronunciar(frase)}</span>
        </p>
        <button className="boton" onClick={() => decir(frase)}>
          ▶ Escuchar
        </button>
      </section>

      <input
        className="pronunciacion-buscar"
        type="search"
        placeholder={`Buscar entre ${GLOSARIO.length} términos (SQL, JWT, milisegundos…)`}
        value={consulta}
        onChange={(e) => setConsulta(e.target.value)}
        aria-label="Buscar un término"
      />
      {hallados.length === 0 && <p className="nota">Ningún término coincide. Si la voz lo lee mal, añádelo al glosario.</p>}
      {grupos.map(([grupo, terminos]) => (
        <section key={grupo} className="pronunciacion-grupo">
          <h2>{grupo}</h2>
          <ul>
            {terminos.map((t) => (
              <li key={t.escrito}>
                <code>{t.escrito}</code>
                {t.variantes?.length ? <small className="nota"> también {t.variantes.join(', ')}</small> : null}
                <span className="pronunciacion-dicho">«{t.se_dice.trim()}»</span>
                <button className="boton-mini" onClick={() => decir(t.escrito)} aria-label={`Escuchar ${t.escrito}`} title="Escuchar con tu voz">
                  ▶
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
