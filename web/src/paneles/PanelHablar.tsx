import { useCallback, useEffect, useRef, useState } from 'react'
import { crearConversacion, enviar } from '../api.ts'
import Pensando from '../componentes/Pensando.tsx'
import Mascota from '../Mascota.tsx'
import { Locutor } from '../componentes/voz.ts'
import ControlVoz from '../componentes/ControlVoz.tsx'
import { TextoError } from '../componentes/Cargando.tsx'

// Hablar: estudias de palabra. Dices tu pregunta, el tutor contesta para el oído y te lo lee; luego vuelve a escucharte.
// La respuesta se lee con una voz instalada en tu equipo. El dictado usa el reconocimiento de voz del navegador.

type Estado = 'quieto' | 'escuchando' | 'pensando' | 'hablando'

interface Turno {
  rol: 'usuario' | 'tutor'
  texto: string
}

interface Reconocimiento {
  lang: string
  interimResults: boolean
  continuous: boolean
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null
  onend: (() => void) | null
  onerror: ((e: { error: string }) => void) | null
}

const Reconocedor = (window as unknown as { SpeechRecognition?: new () => Reconocimiento; webkitSpeechRecognition?: new () => Reconocimiento })
  .SpeechRecognition ??
  (window as unknown as { webkitSpeechRecognition?: new () => Reconocimiento }).webkitSpeechRecognition

function vozLocal(): SpeechSynthesisVoice | null {
  const es = (window.speechSynthesis?.getVoices() ?? []).filter((v) => v.lang.toLowerCase().startsWith('es'))
  return es.find((v) => v.localService && v.lang === 'es-ES') ?? es.find((v) => v.localService) ?? null
}

// Lo que se lee: sin bloques, sin marcas de Markdown y con las fórmulas avisadas.
export function paraLeer(t: string): string {
  return t
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\$\$[\s\S]*?\$\$/g, ' (fórmula en pantalla) ')
    .replace(/\$([^$\n]+)\$/g, '$1')
    .replace(/\[(\d+)\]/g, '')
    .replace(/[#*_`>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export default function PanelHablar({ alCambiar }: { alCambiar?: () => void }) {
  const [estado, setEstado] = useState<Estado>('quieto')
  const [turnos, setTurnos] = useState<Turno[]>([])
  const [parcial, setParcial] = useState('')
  const [escrito, setEscrito] = useState('')
  const [seguido, setSeguido] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const cid = useRef<number | null>(null)
  const rec = useRef<Reconocimiento | null>(null)
  const voz = useRef<SpeechSynthesisVoice | null>(null)
  const control = useRef<AbortController | null>(null)
  const locutor = useRef(new Locutor())

  useEffect(() => {
    const cargar = () => (voz.current = vozLocal())
    cargar()
    window.speechSynthesis?.addEventListener('voiceschanged', cargar)
    return () => {
      window.speechSynthesis?.removeEventListener('voiceschanged', cargar)
      window.speechSynthesis?.cancel()
      rec.current?.abort()
      control.current?.abort()
    }
  }, [])

  const escuchar = useCallback(() => {
    if (!Reconocedor) {
      setError('Este navegador no tiene dictado por voz. Escribe abajo y te contesto en voz alta.')
      return
    }
    setError(null)
    setParcial('')
    const r = new Reconocedor()
    r.lang = 'es-ES'
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
      if (e.error !== 'no-speech' && e.error !== 'aborted') setError(`El dictado falló (${e.error}).`)
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
  }, [])

  const mandar = async (texto: string) => {
    setParcial('')
    setTurnos((t) => [...t, { rol: 'usuario', texto }, { rol: 'tutor', texto: '' }])
    setEstado('pensando')
    try {
      if (cid.current == null) {
        const c = await crearConversacion(`Hablar: ${texto.slice(0, 40)}`)
        cid.current = c.id
        alCambiar?.()
      }
      control.current = new AbortController()
      let respuesta = ''
      // Empieza a hablar con la primera frase, sin esperar a la respuesta entera.
      const l = locutor.current
      l.nueva()
      l.alFrase = () => setEstado('hablando')
      for await (const ev of enviar(cid.current, texto, control.current.signal, true, true)) {
        if (ev.tipo === 'delta') {
          respuesta += ev.t
          l.empujar(respuesta)
          setTurnos((t) => [...t.slice(0, -1), { rol: 'tutor', texto: respuesta }])
        } else if (ev.tipo === 'error') throw new Error(ev.detalle)
      }
      l.empujar(respuesta, true)
      await l.terminado()
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
      <h1>Hablar</h1>
      <p className="nota">
        Pulsa el micrófono, pregunta en voz alta y escucha la respuesta. Cuando acaba, te vuelve a escuchar.
      </p>

      <button
        className={`hablar-micro ${estado}`}
        onClick={estado === 'quieto' ? escuchar : parar}
        aria-label={estado === 'quieto' ? 'Empezar a hablar' : 'Parar'}
      >
        {estado === 'quieto' ? '🎙' : estado === 'escuchando' ? '●' : '■'}
      </button>
      <p className="hablar-estado" aria-live="polite">
        {estado === 'escuchando' && (parcial || 'Te escucho…')}
        {estado === 'pensando' && <Pensando texto="Pensando…" />}
        {estado === 'hablando' && 'Hablando… (pulsa para cortar)'}
        {estado === 'quieto' && (turnos.length ? 'Pulsa para seguir hablando' : 'Pulsa para empezar')}
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
        <input value={escrito} onChange={(e) => setEscrito(e.target.value)} placeholder="O escríbelo y te contesto en voz alta" aria-label="Pregunta escrita" />
        <button className="boton" disabled={!escrito.trim() || estado !== 'quieto'}>
          Enviar
        </button>
      </form>

      <div className="hablar-ajustes">
        <label>
          <input type="checkbox" checked={seguido} onChange={(e) => setSeguido(e.target.checked)} /> Volver a escuchar al acabar
        </label>
        <ControlVoz />
      </div>
      {error && <TextoError texto={error} />}
      <p className="nota hablar-aviso">
        La respuesta se lee con una voz instalada en tu equipo. El dictado es el de tu navegador: en Chrome, el audio se envía a
        Google para pasarlo a texto. Si prefieres que no salga de tu equipo, escribe la pregunta.
      </p>

      {turnos.length > 0 && (
        <details className="hablar-transcripcion">
          <summary>Ver la conversación escrita</summary>
          {turnos.map((t, i) => (
            <p key={i} className={t.rol}>
              <strong>{t.rol === 'usuario' ? 'Tú' : 'Tutor'}:</strong> {paraLeer(t.texto)}
            </p>
          ))}
        </details>
      )}
    </div>
  )
}
