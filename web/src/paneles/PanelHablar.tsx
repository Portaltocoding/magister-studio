import { useCallback, useEffect, useRef, useState } from 'react'
import { crearConversacion, enviar } from '../api.ts'
import Pensando from '../componentes/Pensando.tsx'
import Mascota from '../Mascota.tsx'
import { LENGUA, Locutor, paraLeer, Reconocedor, type Reconocimiento } from '../componentes/voz.ts'
import { t } from '../i18n/i18n.ts'
import { usarIdioma } from '../i18n/usarIdioma.ts'
import ControlVoz from '../componentes/ControlVoz.tsx'
import { TextoError } from '../componentes/Cargando.tsx'

// Hablar: estudias de palabra. Dices tu pregunta, el tutor contesta para el oído y te lo lee; luego vuelve a escucharte.
// La respuesta se lee con una voz instalada en tu equipo. El dictado usa el reconocimiento de voz del navegador.

type Estado = 'quieto' | 'escuchando' | 'pensando' | 'hablando'

interface Turno {
  rol: 'usuario' | 'tutor'
  texto: string
}

export default function PanelHablar({ alCambiar }: { alCambiar?: () => void }) {
  const { idioma } = usarIdioma() // los textos y la voz siguen al idioma
  const [estado, setEstado] = useState<Estado>('quieto')
  const [turnos, setTurnos] = useState<Turno[]>([])
  const [parcial, setParcial] = useState('')
  const [escrito, setEscrito] = useState('')
  const [seguido, setSeguido] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const cid = useRef<number | null>(null)
  const rec = useRef<Reconocimiento | null>(null)
  const control = useRef<AbortController | null>(null)
  const locutor = useRef(new Locutor())

  useEffect(() => {
    return () => {
      window.speechSynthesis?.cancel()
      rec.current?.abort()
      control.current?.abort()
    }
  }, [])

  const escuchar = useCallback(() => {
    if (!Reconocedor) {
      setError(t('llamada.hablar.sinDictado'))
      return
    }
    setError(null)
    setParcial('')
    const r = new Reconocedor()
    r.lang = LENGUA[idioma]
    r.interimResults = true
    r.continuous = false
    let final = ''
    r.onresult = (e) => {
      let provisional = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const x = e.results[i]
        if (x.isFinal) final += x[0].transcript
        else provisional += x[0].transcript
      }
      setParcial(final + provisional)
    }
    r.onerror = (e) => {
      if (e.error !== 'no-speech' && e.error !== 'aborted') setError(t('llamada.hablar.dictadoFalla', { error: e.error }))
    }
    r.onend = () => {
      rec.current = null
      if (final.trim()) mandar(final.trim())
      else setEstado('quieto')
    }
    rec.current = r
    setEstado('escuchando')
    r.start()
    // mandar se define abajo; se usa al acabar de escuchar
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idioma])

  const mandar = async (texto: string) => {
    setParcial('')
    setTurnos((t) => [...t, { rol: 'usuario', texto }, { rol: 'tutor', texto: '' }])
    setEstado('pensando')
    try {
      if (cid.current == null) {
        const c = await crearConversacion(`${t('llamada.hablar.titulo')}: ${texto.slice(0, 40)}`)
        cid.current = c.id
        alCambiar?.()
      }
      const c = new AbortController()
      control.current = c
      let respuesta = ''
      // Empieza a hablar con la primera frase, sin esperar a la respuesta entera.
      const l = locutor.current
      l.nueva()
      l.alFrase = () => setEstado('hablando')
      for await (const ev of enviar(cid.current, texto, c.signal, true, true)) {
        if (ev.tipo === 'delta') {
          respuesta += ev.t
          l.empujar(respuesta)
          setTurnos((t) => [...t.slice(0, -1), { rol: 'tutor', texto: respuesta }])
        } else if (ev.tipo === 'error') throw new Error(ev.detalle)
      }
      l.empujar(respuesta, true)
      await l.terminado()
      // Si has pulsado «Parar», se queda quieto: no vuelve a abrir el micrófono.
      if (c.signal.aborted) return
      setEstado('quieto')
      if (seguido && Reconocedor) escuchar()
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) setError(String((e as Error).message))
      setEstado('quieto')
    }
  }

  const parar = () => {
    rec.current?.abort()
    control.current?.abort()
    locutor.current.parar()
    setEstado('quieto')
  }

  const ultimo = [...turnos].reverse().find((t) => t.rol === 'tutor' && t.texto)

  return (
    <div className="hablar">
      <Mascota lugar="hablar" />
      <h1>{t('llamada.hablar.titulo')}</h1>
      <p className="nota">
        {t('llamada.hablar.intro')}
      </p>

      <button
        className={`hablar-micro ${estado}`}
        onClick={estado === 'quieto' ? escuchar : parar}
        aria-label={estado === 'quieto' ? t('llamada.hablar.empezar') : t('llamada.hablar.parar')}
      >
        {estado === 'quieto' ? '🎙' : estado === 'escuchando' ? '●' : '■'}
      </button>
      <p className="hablar-estado" aria-live="polite">
        {estado === 'escuchando' && (parcial || t('llamada.hablar.teEscucho'))}
        {estado === 'pensando' && <Pensando texto={t('llamada.hablar.pensando')} />}
        {estado === 'hablando' && t('llamada.hablar.hablando')}
        {estado === 'quieto' && (turnos.length ? t('llamada.hablar.seguir') : t('llamada.hablar.empezarPulsa'))}
      </p>

      {ultimo && <p className="hablar-respuesta">{paraLeer(ultimo.texto)}</p>}

      <form
        className="hablar-escribir"
        onSubmit={(e) => {
          e.preventDefault()
          if (escrito.trim() && estado === 'quieto') {
            mandar(escrito.trim())
            setEscrito('')
          }
        }}
      >
        <input value={escrito} onChange={(e) => setEscrito(e.target.value)} placeholder={t('llamada.hablar.escribelo')} aria-label={t('llamada.hablar.preguntaEscrita')} />
        <button className="boton" disabled={!escrito.trim() || estado !== 'quieto'}>
          {t('llamada.hablar.enviar')}
        </button>
      </form>

      <div className="hablar-ajustes">
        <label>
          <input type="checkbox" checked={seguido} onChange={(e) => setSeguido(e.target.checked)} /> {t('llamada.hablar.volverEscuchar')}
        </label>
        <ControlVoz />
      </div>
      {error && <TextoError texto={error} />}
      <p className="nota hablar-aviso">
        {t('llamada.hablar.aviso')}
      </p>

      {turnos.length > 0 && (
        <details className="hablar-transcripcion">
          <summary>{t('llamada.hablar.verEscrita')}</summary>
          {turnos.map((x, i) => (
            <p key={i} className={x.rol}>
              <strong>{x.rol === 'usuario' ? t('llamada.hablar.tu') : t('llamada.hablar.tutor')}:</strong> {paraLeer(x.texto)}
            </p>
          ))}
        </details>
      )}
    </div>
  )
}
