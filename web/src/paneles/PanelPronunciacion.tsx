// Taller → Pronunciación: el glosario de cómo dice la voz cada término técnico. Se busca por cómo se escribe, cómo se
// dice o su grupo; cada término se escucha con la voz elegida, y una frase de prueba enseña lo que le llega a la voz.
// Para añadir o corregir un término: una línea en componentes/pronunciacion.ts.
import { useEffect, useMemo, useRef, useState } from 'react'
import { buscarTerminos, GLOSARIO } from '../componentes/pronunciacion.ts'
import { Locutor, pronunciar } from '../componentes/voz.ts'
import { t } from '../i18n/i18n.ts'
import { usarIdioma } from '../i18n/usarIdioma.ts'

const EJEMPLO = () => t('llamada.pron.ejemplo')

export default function PanelPronunciacion() {
  usarIdioma() // los textos siguen al idioma
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
    for (const x of hallados) m.set(x.grupo, [...(m.get(x.grupo) ?? []), x])
    return [...m.entries()]
  }, [hallados])

  return (
    <div className="panel pronunciacion">
      <div className="cabecera-panel">
        <h1>{t('llamada.pron.titulo')}</h1>
      </div>
      <p className="nota">
        {t('llamada.pron.intro')} <code>componentes/pronunciacion.ts</code>.
      </p>

      <section className="pronunciacion-prueba tarjeta">
        <label htmlFor="frase-prueba">{t('llamada.pron.prueba')}</label>
        <textarea id="frase-prueba" rows={2} value={frase} onChange={(e) => setFrase(e.target.value)} />
        <p className="nota">
          {t('llamada.pron.recibe')} <span className="pronunciacion-dicho">{pronunciar(frase)}</span>
        </p>
        <button className="boton" onClick={() => decir(frase)}>
          ▶ {t('llamada.pron.escuchar')}
        </button>
      </section>

      <input
        className="pronunciacion-buscar"
        type="search"
        placeholder={t('llamada.pron.buscarEntre', { n: GLOSARIO.length })}
        value={consulta}
        onChange={(e) => setConsulta(e.target.value)}
        aria-label={t('llamada.pron.buscarUno')}
      />
      {hallados.length === 0 && <p className="nota">{t('llamada.pron.ninguno')}</p>}
      {grupos.map(([grupo, terminos]) => (
        <section key={grupo} className="pronunciacion-grupo">
          <h2>{grupo}</h2>
          <ul>
            {terminos.map((x) => (
              <li key={x.escrito}>
                <code>{x.escrito}</code>
                {x.variantes?.length ? <small className="nota"> {t('llamada.pron.tambien')} {x.variantes.join(', ')}</small> : null}
                <span className="pronunciacion-dicho">«{x.se_dice.trim()}»</span>
                <button className="boton-mini" onClick={() => decir(x.escrito)} aria-label={t('llamada.pron.escucharTermino', { termino: x.escrito })} title={t('llamada.pron.conTuVoz')}>
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
