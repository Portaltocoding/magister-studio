import { useEffect, useState } from 'react'
import { delIdioma, guardarAjustesVoz, leerAjustesVoz, vocesMagister, VELOCIDADES, type AjustesVoz } from './voz.ts'
import { idiomaActual, t } from '../i18n/i18n.ts'
import { usarIdioma } from '../i18n/usarIdioma.ts'

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

// Las voces del navegador y las de Magister del idioma de ahora.
const vocesDelIdioma = () => delIdioma(window.speechSynthesis?.getVoices() ?? [], idiomaActual())
const naturalesDelIdioma = () => vocesMagister.filter((v) => (v.idioma ?? 'es') === idiomaActual())

export default function ControlVoz({ compacto = false }: { compacto?: boolean }) {
  const { idioma } = usarIdioma() // las voces y los textos siguen al idioma
  const [a, cambiar] = usarAjustesVoz()
  const [voces, setVoces] = useState(vocesDelIdioma)
  const [naturales, setNaturales] = useState(naturalesDelIdioma)
  useEffect(() => {
    setVoces(vocesDelIdioma())
    setNaturales(naturalesDelIdioma())
    const cargar = () => setVoces(vocesDelIdioma())
    const cargarNaturales = () => setNaturales(naturalesDelIdioma())
    window.speechSynthesis?.addEventListener('voiceschanged', cargar)
    window.addEventListener('magister-voces', cargarNaturales)
    return () => {
      window.speechSynthesis?.removeEventListener('voiceschanged', cargar)
      window.removeEventListener('magister-voces', cargarNaturales)
    }
  }, [idioma])
  return (
    <div className={`control-voz ${compacto ? 'compacto' : ''}`}>
      <div className="control-voz-velocidad" role="radiogroup" aria-label={t('llamada.voz.velocidadAria')}>
        {!compacto && <span className="nota">{t('llamada.voz.velocidad')}</span>}
        {VELOCIDADES.map((v) => (
          <button key={v} type="button" role="radio" aria-checked={a.velocidad === v} className={`opcion opcion-chip ${a.velocidad === v ? 'elegida' : ''}`} onClick={() => cambiar({ velocidad: v })}>
            {idioma === 'en' ? String(v) : String(v).replace('.', ',')}×
          </button>
        ))}
      </div>
      {voces.length + naturales.length > 1 && (
        <label className="control-voz-voz">
          {!compacto && <span className="nota">{t('llamada.voz.voz')}</span>}
          <select value={a.voz ?? ''} onChange={(e) => cambiar({ voz: e.target.value || null })} aria-label={t('llamada.voz.voz')}>
            <option value="">{naturales.length ? t('llamada.voz.natural', { nombre: naturales[0].nombre }) : t('llamada.voz.mejor')}</option>
            {naturales.length > 0 && (
              <optgroup label={t('llamada.voz.grupoMagister')}>
                {naturales.map((v) => (
                  <option key={v.id} value={`piper:${v.id}`}>
                    {v.nombre}
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label={t('llamada.voz.grupoNavegador')}>
              <option value="navegador">{t('llamada.voz.deTuEquipo')}</option>
              {voces.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.name.replace(/^Microsoft |^Google /, '').replace(/ - (Spanish|English).*$/, '')}
                  {v.localService ? '' : t('llamada.voz.enLinea')}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
      )}
    </div>
  )
}
