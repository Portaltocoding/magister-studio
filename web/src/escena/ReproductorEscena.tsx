// El reproductor del vídeo animado: el Player de Remotion y el esqueleto de tesis a un lado (pulsas una y saltas).
// Antes de reproducir se prepara la voz de Magister: cada trozo de la narración se sintetiza y se mide, y va como audio
// dentro de la composición. Así cada tramo dura lo que dura su voz, y pausar, saltar o cambiar la velocidad lleva voz,
// imagen y subtítulos a la vez, sin nada aparte. Sin la voz de Magister, los tiempos se estiman y el Locutor habla
// por fuera, como antes. Con el vídeo parado, la escena se puede tocar.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Player, type PlayerRef } from '@remotion/player'
import Pensando from '../componentes/Pensando.tsx'
import { leerAjustesVoz, Locutor, VELOCIDADES } from '../componentes/voz.ts'
import { Composicion, type PropsComposicion } from './Composicion.tsx'
import { ALTO, ANCHO, FPS, lineaDeTiempo, tramoEn, trozoEn, type GuionGrafico } from './tipos.ts'
import { avisoSinMagister, prepararVoz, type VozPreparada } from './vozVideo.ts'

export default function ReproductorEscena({ guion, segundo = 0 }: { guion: GuionGrafico; segundo?: number }) {
  // Lo preparado y el avance van con su guion: si llega otro, lo de antes no vale (sin reiniciar estado en el efecto).
  const [preparada, setPreparada] = useState<{ guion: GuionGrafico; voz: VozPreparada } | null>(null)
  const [progreso, setProgreso] = useState<{ guion: GuionGrafico; hechos: number; total: number } | null>(null)
  const voz = preparada?.guion === guion ? preparada.voz : null
  const avance = progreso?.guion === guion ? progreso : { hechos: 0, total: 0 }
  const cancelar = useRef<() => void>(() => undefined)

  // La voz se prepara una vez por guion; al salir (o con otro guion) se sueltan sus audios.
  useEffect(() => {
    let vigente = true
    let hecha: VozPreparada | null = null
    const ac = new AbortController()
    cancelar.current = () => ac.abort()
    void prepararVoz(guion, { signal: ac.signal, alAvance: (hechos, total) => vigente && setProgreso({ guion, hechos, total }) }).then((v) => {
      if (!vigente) return v.liberar()
      hecha = v
      setPreparada({ guion, voz: v })
    })
    return () => {
      vigente = false
      ac.abort()
      hecha?.liberar()
    }
  }, [guion])

  if (!voz)
    return (
      <div className="escena">
        <div className="escena-pantalla">
          <div
            className="escena-reproductor"
            style={{
              aspectRatio: `${ANCHO} / ${ALTO}`, borderRadius: 14, border: '1px solid rgba(127,127,127,0.3)', display: 'grid', placeItems: 'center',
              alignContent: 'center', gap: 12, padding: 16, textAlign: 'center',
            }}
          >
            <Pensando texto={avance.total ? `Preparando la voz… ${avance.hechos} de ${avance.total}` : 'Preparando la voz…'} />
            {avance.total > 0 && <progress max={avance.total} value={avance.hechos} style={{ width: 'min(320px, 80%)' }} aria-label="Voz preparada" />}
            <button type="button" className="boton boton-suave" onClick={() => cancelar.current()}>
              Ver sin esperar
            </button>
            <span className="nota">Cada frase se dice una vez y se mide: así la voz va clavada a la imagen.</span>
          </div>
        </div>
      </div>
    )
  return <Reproductor guion={guion} segundo={segundo} voz={voz} />
}

function Reproductor({ guion, segundo, voz }: { guion: GuionGrafico; segundo: number; voz: VozPreparada }) {
  const player = useRef<PlayerRef>(null)
  const conMagister = voz.modo === 'magister'
  // La velocidad de voz elegida. Con la voz de Magister la línea de tiempo va a velocidad 1 y el Player acelera imagen
  // y voz a la vez (y se puede cambiar a mitad sin descuadrar nada). Sin ella, estira los tramos estimados, como antes.
  const [ritmo] = useState(() => leerAjustesVoz().velocidad)
  const [velocidad, setVelocidad] = useState(ritmo)
  const medidas = conMagister ? voz.medidas : null
  const audios = conMagister ? voz.audios : null
  const ritmoLinea = conMagister ? 1 : ritmo
  const linea = useMemo(() => lineaDeTiempo(guion, ritmoLinea, medidas), [guion, ritmoLinea, medidas])
  const desde = useMemo(() => linea.tramos.map((t) => t.desde), [linea])
  const total = Math.max(1, linea.total)
  const inicial = Math.min(total - 1, Math.max(0, Math.round(segundo * FPS)))
  const [actual, setActual] = useState(() => tramoEn(desde, inicial))
  const [conVoz, setConVoz] = useState(true)
  const [subtitulos, setSubtitulos] = useState(true)
  const conVozRef = useRef(conVoz)
  useEffect(() => {
    conVozRef.current = conVoz
  }, [conVoz])

  // El tramo que se ve, para marcarlo en el esqueleto.
  useEffect(() => {
    const p = player.current
    if (!p) return
    const alFotograma = (e: { detail: { frame: number } }) => setActual(tramoEn(desde, e.detail.frame))
    p.addEventListener('frameupdate', alFotograma)
    return () => p.removeEventListener('frameupdate', alFotograma)
  }, [desde])

  // Con la voz de Magister: la velocidad la lleva el Player (su menú o el ajuste de voz de otro panel) y «Voz» lo silencia.
  useEffect(() => {
    const p = player.current
    if (!p || !conMagister) return
    const alAjuste = () => setVelocidad(leerAjustesVoz().velocidad)
    const alRitmo = (e: { detail: { playbackRate: number } }) => setVelocidad(e.detail.playbackRate)
    const alSilencio = (e: { detail: { isMuted: boolean } }) => setConVoz(!e.detail.isMuted)
    window.addEventListener('magister-voz', alAjuste)
    p.addEventListener('ratechange', alRitmo)
    p.addEventListener('mutechange', alSilencio)
    return () => {
      window.removeEventListener('magister-voz', alAjuste)
      p.removeEventListener('ratechange', alRitmo)
      p.removeEventListener('mutechange', alSilencio)
    }
  }, [conMagister])

  // Sin la voz de Magister, el Locutor dice cada tramo al empezar (o al darle a reproducir), desde el trozo que toca
  // según el fotograma: pausar y seguir no repite el tramo desde el principio.
  const locutor = useRef<Locutor | null>(null)
  useEffect(() => {
    const p = player.current
    if (!p || conMagister) return
    const l = (locutor.current ??= new Locutor())
    let dicho = -1
    const decir = (i: number, frame: number) => {
      dicho = i
      l.nueva()
      if (!conVozRef.current) return
      const t = linea.tramos[i]
      // El locutor ya pasa cada trozo por `pronunciar`.
      l.decirTodo(t.trozos.slice(trozoEn(t.trozos, frame - t.desde)).map((z) => z.texto))
      l.cerrar()
    }
    const alFotograma = (e: { detail: { frame: number } }) => {
      const i = tramoEn(desde, e.detail.frame)
      if (p.isPlaying() && i !== dicho) decir(i, e.detail.frame)
    }
    const alTocar = () => {
      const f = p.getCurrentFrame()
      decir(tramoEn(desde, f), f)
    }
    // Un salto con el vídeo en marcha (también dentro del mismo tramo) vuelve a decir desde donde cae.
    const alSaltar = (e: { detail: { frame: number } }) => {
      if (p.isPlaying()) decir(tramoEn(desde, e.detail.frame), e.detail.frame)
    }
    const alParar = () => {
      dicho = -1
      l.parar()
    }
    p.addEventListener('frameupdate', alFotograma)
    p.addEventListener('play', alTocar)
    p.addEventListener('seeked', alSaltar)
    p.addEventListener('pause', alParar)
    p.addEventListener('ended', alParar)
    return () => {
      p.removeEventListener('frameupdate', alFotograma)
      p.removeEventListener('play', alTocar)
      p.removeEventListener('seeked', alSaltar)
      p.removeEventListener('pause', alParar)
      p.removeEventListener('ended', alParar)
      l.parar()
    }
  }, [conMagister, desde, linea])

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

  const props: PropsComposicion = useMemo(() => ({ guion, subtitulos, ritmo: ritmoLinea, medidas, audios }), [guion, subtitulos, ritmoLinea, medidas, audios])

  const cambiarVoz = (si: boolean) => {
    setConVoz(si)
    if (conMagister) {
      if (si) {
        player.current?.unmute()
        if (player.current?.getVolume() === 0) player.current.setVolume(1) // «Voz» marcada tiene que sonar
      } else player.current?.mute()
    } else if (!si) locutor.current?.parar()
  }

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
          // El primer «reproducir» es tuyo (botón o espacio): con ese gesto el Player desbloquea sus etiquetas de audio
          // y las reutiliza para cada trozo de voz, así el navegador no bloquea los que empiezan después.
          numberOfSharedAudioTags={5}
          playbackRate={conMagister ? velocidad : 1}
          showPlaybackRateControl={conMagister ? VELOCIDADES : false}
          style={{ width: '100%', aspectRatio: `${ANCHO} / ${ALTO}`, borderRadius: 14, overflow: 'hidden' }}
        />
        {tocando && <button type="button" className="escena-pausar" aria-label="Pausar" onClick={() => player.current?.pause()} />}
        </div>
        <div className="escena-ajustes">
          <label>
            <input type="checkbox" checked={conVoz} onChange={(e) => cambiarVoz(e.target.checked)} /> Voz
          </label>
          <label>
            <input type="checkbox" checked={subtitulos} onChange={(e) => setSubtitulos(e.target.checked)} /> Subtítulos
          </label>
          <span className="nota">Espacio para pausar. Con el vídeo parado, los botones de la escena se pueden pulsar.</span>
          {voz.modo === 'navegador' && <span className="nota">{avisoSinMagister(voz.motivo)}</span>}
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
