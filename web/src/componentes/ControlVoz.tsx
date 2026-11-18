import { useEffect, useState } from 'react'
import { guardarAjustesVoz, leerAjustesVoz, vocesEspanol, vocesMagister, VELOCIDADES, type AjustesVoz } from './voz.ts'

// Velocidad y voz del tutor: se aplican al momento (la frase que suena se repite con lo nuevo) y valen en todas partes.
export function usarAjustesVoz(): [AjustesVoz, (a: Partial<AjustesVoz>) => void] {
  const [a, setA] = useState<AjustesVoz>(leerAjustesVoz)
  useEffect(() => {
    const al = (e: Event) => setA((e as CustomEvent<AjustesVoz>).detail)
    window.addEventListener('magister-voz', al)
    return () => window.removeEventListener('magister-voz', al)
  }, [])
  return [a, (c) => guardarAjustesVoz({ ...leerAjustesVoz(), ...c })]
}

export default function ControlVoz({ compacto = false }: { compacto?: boolean }) {
  const [a, cambiar] = usarAjustesVoz()
  const [voces, setVoces] = useState(vocesEspanol)
  const [naturales, setNaturales] = useState(vocesMagister)
  useEffect(() => {
    const cargar = () => setVoces(vocesEspanol())
    const cargarNaturales = () => setNaturales(vocesMagister)
    window.speechSynthesis?.addEventListener('voiceschanged', cargar)
    window.addEventListener('magister-voces', cargarNaturales)
    return () => {
      window.speechSynthesis?.removeEventListener('voiceschanged', cargar)
      window.removeEventListener('magister-voces', cargarNaturales)
    }
  }, [])
  return (
    <div className={`control-voz ${compacto ? 'compacto' : ''}`}>
      <div className="control-voz-velocidad" role="radiogroup" aria-label="Velocidad de la voz">
        {!compacto && <span className="nota">Velocidad</span>}
        {VELOCIDADES.map((v) => (
          <button key={v} type="button" role="radio" aria-checked={a.velocidad === v} className={`opcion opcion-chip ${a.velocidad === v ? 'elegida' : ''}`} onClick={() => cambiar({ velocidad: v })}>
            {String(v).replace('.', ',')}×
          </button>
        ))}
      </div>
      {voces.length + naturales.length > 1 && (
        <label className="control-voz-voz">
          {!compacto && <span className="nota">Voz</span>}
          <select value={a.voz ?? ''} onChange={(e) => cambiar({ voz: e.target.value || null })} aria-label="Voz">
            <option value="">{naturales.length ? `Natural: ${naturales[0].nombre}` : 'La mejor que haya'}</option>
            {naturales.length > 0 && (
              <optgroup label="Voces naturales de Magister (en tu equipo)">
                {naturales.map((v) => (
                  <option key={v.id} value={`piper:${v.id}`}>
                    {v.nombre}
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label="Voces del navegador">
              <option value="navegador">La de tu equipo</option>
              {voces.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.name.replace(/^Microsoft |^Google /, '').replace(/ - Spanish.*$/, '')}
                  {v.localService ? '' : ' (en línea)'}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
      )}
    </div>
  )
}
