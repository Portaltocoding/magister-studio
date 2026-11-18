// El reproductor del vídeo animado: el Player de Remotion, el esqueleto de tesis a un lado (pulsas una y saltas)
// y la voz de Magister diciendo cada tramo cuando empieza. Con el vídeo parado, la escena se puede tocar.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Player, type PlayerRef } from '@remotion/player'
import { leerAjustesVoz, Locutor } from '../componentes/voz.ts'
import { Composicion, type PropsComposicion } from './Composicion.tsx'
import { ALTO, ANCHO, FPS, duracionTotal, frases, inicios, respiros, type GuionGrafico } from './tipos.ts'

function tramoEn(desde: number[], frame: number): number {
  let i = 0
  while (i + 1 < desde.length && desde[i + 1] <= frame) i++
  return i
}

export default function ReproductorEscena({ guion, segundo = 0 }: { guion: GuionGrafico; segundo?: number }) {
  const player = useRef<PlayerRef>(null)
  // Un solo locutor para todo el vídeo (no uno nuevo en cada pintado).
  const [locutorUnico] = useState(() => new Locutor())
  const locutor = useRef(locutorUnico)
  // La velocidad de voz elegida fija el ritmo de los tramos: la narración y la animación van a la par.
  const [ritmo] = useState(() => leerAjustesVoz().velocidad)
  const desde = useMemo(() => inicios(guion, ritmo), [guion, ritmo])
  const total = useMemo(() => duracionTotal(guion, ritmo), [guion, ritmo])
  const inicial = Math.min(total - 1, Math.max(0, Math.round(segundo * FPS)))
  const [actual, setActual] = useState(() => tramoEn(desde, inicial))
  const [voz, setVoz] = useState(true)
  const [subtitulos, setSubtitulos] = useState(true)
  const vozRef = useRef(voz)
  useEffect(() => {
    vozRef.current = voz
  }, [voz])

  // La voz va por tramos: al empezar uno (o al darle a reproducir) dice su narración entera.
  useEffect(() => {
    const p = player.current
    const l = locutor.current
    if (!p) return
    let dicho = -1
    const decir = (i: number) => {
      dicho = i
      l.nueva()
      if (!vozRef.current) return
      // El locutor ya pasa cada frase por `pronunciar`. Cada frase va en tramos cortados en comas, punto y coma y dos
      // puntos (no en la coma decimal de «121,353»): así la voz respira donde el texto lo pide.
      for (const f of frases(guion.tramos[i].narracion)) for (const t of respiros(f)) l.decir(t)
      l.cerrar()
    }
    const alFotograma = (e: { detail: { frame: number } }) => {
      const i = tramoEn(desde, e.detail.frame)
      setActual(i)
      if (p.isPlaying() && i !== dicho) decir(i)
    }
    const alTocar = () => decir(tramoEn(desde, p.getCurrentFrame()))
    const alParar = () => {
      dicho = -1
      l.parar()
    }
    p.addEventListener('frameupdate', alFotograma)
    p.addEventListener('play', alTocar)
    p.addEventListener('pause', alParar)
    p.addEventListener('ended', alParar)
    return () => {
      p.removeEventListener('frameupdate', alFotograma)
      p.removeEventListener('play', alTocar)
      p.removeEventListener('pause', alParar)
      p.removeEventListener('ended', alParar)
      l.parar()
    }
  }, [desde, guion])

  // Mientras suena, pulsar en cualquier parte de la imagen lo pausa (una capa encima, que deja libre la barra de
  // controles). Parado, la capa no está: los botones de la escena se pueden tocar.
  const [tocando, setTocando] = useState(false)
  useEffect(() => {
    const p = player.current
    if (!p) return
    const si = () => setTocando(true)
    const no = () => setTocando(false)
    p.addEventListener('play', si)
    p.addEventListener('pause', no)
    p.addEventListener('ended', no)
    return () => {
      p.removeEventListener('play', si)
      p.removeEventListener('pause', no)
      p.removeEventListener('ended', no)
    }
  }, [])

  const props: PropsComposicion = useMemo(() => ({ guion, subtitulos, ritmo }), [guion, subtitulos, ritmo])

  return (
    <div className="escena">
      <div className="escena-pantalla">
        <div className="escena-reproductor">
        <Player
          ref={player}
          component={Composicion}
          inputProps={props}
          durationInFrames={total}
          fps={FPS}
          compositionWidth={ANCHO}
          compositionHeight={ALTO}
          initialFrame={inicial}
          controls
          clickToPlay={false}
          spaceKeyToPlayOrPause
          allowFullscreen
          style={{ width: '100%', aspectRatio: `${ANCHO} / ${ALTO}`, borderRadius: 14, overflow: 'hidden' }}
        />
        {tocando && <button type="button" className="escena-pausar" aria-label="Pausar" onClick={() => player.current?.pause()} />}
        </div>
        <div className="escena-ajustes">
          <label>
            <input type="checkbox" checked={voz} onChange={(e) => (setVoz(e.target.checked), e.target.checked || locutor.current.parar())} /> Voz
          </label>
          <label>
            <input type="checkbox" checked={subtitulos} onChange={(e) => setSubtitulos(e.target.checked)} /> Subtítulos
          </label>
          <span className="nota">Espacio para pausar. Con el vídeo parado, los botones de la escena se pueden pulsar.</span>
        </div>
      </div>
      <aside className="escena-esqueleto">
        <h2>{guion.titulo}</h2>
        <p className="nota">Leídas en fila, las tesis cuentan la lección entera.</p>
        <ol>
          {guion.tramos.map((t, i) => (
            <li key={i}>
              <button
                type="button"
                className={i === actual ? 'actual' : ''}
                onClick={() => {
                  player.current?.seekTo(desde[i])
                  setActual(i)
                }}
              >
                <span className="escena-concepto">{t.concepto}</span>
                <span className="escena-tesis">{t.tesis}</span>
              </button>
            </li>
          ))}
        </ol>
      </aside>
    </div>
  )
}
