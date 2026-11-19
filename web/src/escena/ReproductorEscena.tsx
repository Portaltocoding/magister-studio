// El reproductor del vídeo animado: el Player de Remotion y el esqueleto de tesis a un lado (pulsas una y saltas).
// La voz de Magister se prepara tramo a tramo: cada trozo de la narración se sintetiza y se mide, y va como audio
// dentro de la composición. El vídeo sale en cuanto el primer tramo tiene su voz y el resto se prepara mientras suena. Así cada tramo dura lo que dura su voz, y pausar, saltar o cambiar la velocidad lleva voz,
// imagen y subtítulos a la vez, sin nada aparte. Sin la voz de Magister, los tiempos se estiman y el Locutor habla
// por fuera, como antes. Con el vídeo parado, la escena se puede tocar.
import { useEffect, useMemo, useRef, useState, type MouseEvent as Pulsacion, type SyntheticEvent } from 'react'
import { Player, type PlayerRef } from '@remotion/player'
import Pensando from '../componentes/Pensando.tsx'
import { guardarAjustesVoz, leerAjustesVoz, Locutor, VELOCIDADES } from '../componentes/voz.ts'
import { Composicion, type PropsComposicion } from './Composicion.tsx'
import { accionDeTecla, AYUDA_TECLAS, fotogramaTrasTecla } from './teclas.ts'
import { ALTO, ANCHO, FPS, lineaDeTiempo, tramoEn, trozoEn, verTramo, type GuionGrafico } from './tipos.ts'
import { prepararVoz } from './vozVideo.ts'
import { avance, avisoVoz, conMagister as hayMagister, esperaEn, puedeEmpezar, reubicar, type EstadoVoz } from './vozPorTramos.ts'

export default function ReproductorEscena({ guion, segundo = 0 }: { guion: GuionGrafico; segundo?: number }) {
  // El estado de la voz va con su guion: si llega otro, lo de antes no vale (sin reiniciar estado en el efecto).
  const [preparando, setPreparando] = useState<{ guion: GuionGrafico; voz: EstadoVoz } | null>(null)
  const voz = preparando?.guion === guion ? preparando.voz : null
  const { hechos, total } = voz ? avance(voz) : { hechos: 0, total: 0 }
  const cancelar = useRef<() => void>(() => undefined)

  // La voz se prepara una vez por guion, tramo a tramo; al salir (o con otro guion) se sueltan sus audios.
  useEffect(() => {
    let vigente = true
    const ac = new AbortController()
    cancelar.current = () => ac.abort()
    const p = prepararVoz(guion, { signal: ac.signal, alCambio: (v) => vigente && setPreparando({ guion, voz: v }) })
    return () => {
      vigente = false
      ac.abort()
      p.liberar()
    }
  }, [guion])

  if (!voz || !puedeEmpezar(voz))
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
            <Pensando texto={total ? `Preparando la voz… ${hechos} de ${total}` : 'Preparando la voz…'} />
            {total > 0 && <progress max={total} value={hechos} style={{ width: 'min(320px, 80%)' }} aria-label="Voz preparada" />}
            <button type="button" className="boton boton-suave" onClick={() => cancelar.current()}>
              Ver sin esperar
            </button>
            <span className="nota">Cada frase se dice una vez y se mide: así la voz va clavada a la imagen. Empieza en cuanto está la primera escena.</span>
          </div>
        </div>
      </div>
    )
  return <Reproductor guion={guion} segundo={segundo} voz={voz} sinEsperar={() => cancelar.current()} />
}

function Reproductor({ guion, segundo, voz, sinEsperar }: { guion: GuionGrafico; segundo: number; voz: EstadoVoz; sinEsperar: () => void }) {
  const player = useRef<PlayerRef>(null)
  const conMagister = hayMagister(voz)
  const vozRef = useRef(voz)
  useEffect(() => {
    vozRef.current = voz
  }, [voz])
  const hayNavegador = voz.tramos.includes('navegador')
  // La velocidad de voz elegida. Con la voz de Magister la línea de tiempo va a velocidad 1 y el Player acelera imagen
  // y voz a la vez (y se puede cambiar a mitad sin descuadrar nada). Sin ella, estira los tramos estimados, como antes.
  const [ritmo] = useState(() => leerAjustesVoz().velocidad)
  const [velocidad, setVelocidad] = useState(ritmo)
  // Los tramos aún sin voz (o con la del navegador) van a null: duran la estimación por su texto.
  const { medidas, audios } = voz
  const ritmoLinea = conMagister ? 1 : ritmo
  const linea = useMemo(() => lineaDeTiempo(guion, ritmoLinea, medidas), [guion, ritmoLinea, medidas])
  const desde = useMemo(() => linea.tramos.map((t) => t.desde), [linea])
  const total = Math.max(1, linea.total)

  // Si el vídeo llega a un tramo cuya voz aún se prepara, se para ahí («preparando la voz…») y sigue solo cuando está.
  const [esperando, setEsperando] = useState<number | null>(null)
  const esperandoRef = useRef<number | null>(null)
  useEffect(() => {
    const p = player.current
    if (!p) return
    const mirar = (frame: number) => {
      if (!p.isPlaying()) return
      const i = esperaEn(vozRef.current, desde, frame)
      if (i === null) return
      p.pause()
      esperandoRef.current = i
      setEsperando(i)
    }
    const alFotograma = (e: { detail: { frame: number } }) => mirar(e.detail.frame)
    const alTocar = () => mirar(p.getCurrentFrame())
    // Si saltas a otro tramo mientras espera, ya no sigue solo.
    const alSaltar = (e: { detail: { frame: number } }) => {
      if (esperandoRef.current === null || tramoEn(desde, e.detail.frame) === esperandoRef.current) return
      esperandoRef.current = null
      setEsperando(null)
    }
    p.addEventListener('frameupdate', alFotograma)
    p.addEventListener('play', alTocar)
    p.addEventListener('seeked', alSaltar)
    return () => {
      p.removeEventListener('frameupdate', alFotograma)
      p.removeEventListener('play', alTocar)
      p.removeEventListener('seeked', alSaltar)
    }
  }, [desde])
  // La línea crece según llega la voz: el cabezal se queda en su tramo y a la misma distancia de su inicio (nunca
  // salta atrás). Y si se esperaba un tramo que ya tiene su voz (o ya va con la del navegador), sigue.
  const lineaAntes = useRef(linea)
  useEffect(() => {
    const p = player.current
    const antes = lineaAntes.current
    lineaAntes.current = linea
    if (!p) return
    const i = esperandoRef.current
    if (antes !== linea) {
      const f = p.getCurrentFrame()
      const nuevo = reubicar(antes, linea, f)
      if (nuevo !== f) p.seekTo(nuevo)
    }
    if (i !== null && voz.tramos[i] !== 'pendiente') {
      esperandoRef.current = null
      p.play()
    }
  }, [linea, voz])
  const preparandoVoz = esperando !== null && voz.tramos[esperando] === 'pendiente'
  // Sin segundo pedido, se abre en la primera escena ya entrada (en el fotograma 0 todo es negro: el fundido de entrada).
  const primero = verTramo(desde, 0, total)
  const inicial = segundo > 0 ? Math.min(total - 1, Math.round(segundo * FPS)) : primero
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

  // Con la voz de Magister: la velocidad la lleva el Player (su menú o el ajuste de voz de otro panel). La que eliges
  // en su menú se guarda en el ajuste de voz, el mismo que usan la versión narrada y la lectura en voz alta: el
  // siguiente vídeo (y la siguiente sesión) empieza a esa velocidad.
  useEffect(() => {
    const p = player.current
    if (!p || !conMagister) return
    const alAjuste = () => setVelocidad(leerAjustesVoz().velocidad)
    const alRitmo = (e: { detail: { playbackRate: number } }) => {
      const v = e.detail.playbackRate
      setVelocidad(v)
      const ajustes = leerAjustesVoz()
      if (VELOCIDADES.includes(v) && ajustes.velocidad !== v) guardarAjustesVoz({ ...ajustes, velocidad: v })
    }
    window.addEventListener('magister-voz', alAjuste)
    p.addEventListener('ratechange', alRitmo)
    return () => {
      window.removeEventListener('magister-voz', alAjuste)
      p.removeEventListener('ratechange', alRitmo)
    }
  }, [conMagister])

  // «Voz» y el botón de silencio del Player son lo mismo, con o sin la voz de Magister. Sin ella, la voz es el Locutor
  // (va por fuera del Player): callarlo o, al volver a marcarla con el vídeo en marcha, que siga desde donde va.
  const reanudar = useRef<() => void>(() => undefined)
  const ponerVoz = (si: boolean) => {
    if (conVozRef.current === si) return
    conVozRef.current = si
    setConVoz(si)
    if (si) reanudar.current()
    else locutor.current?.parar()
  }
  const ponerVozRef = useRef(ponerVoz)
  useEffect(() => {
    ponerVozRef.current = ponerVoz
  })
  useEffect(() => {
    const p = player.current
    if (!p) return
    const alSilencio = (e: { detail: { isMuted: boolean } }) => ponerVozRef.current(!e.detail.isMuted)
    p.addEventListener('mutechange', alSilencio)
    return () => p.removeEventListener('mutechange', alSilencio)
  }, [])

  // En los tramos con la voz del navegador (todos, o los que quedaron sin la de Magister al fallar), el Locutor dice
  // cada tramo al empezar (o al darle a reproducir), desde el trozo que toca según el fotograma: pausar y seguir no
  // repite el tramo desde el principio.
  const locutor = useRef<Locutor | null>(null)
  useEffect(() => {
    const p = player.current
    if (!p || !hayNavegador) return
    const l = (locutor.current ??= new Locutor())
    let dicho = -1
    const decir = (i: number, frame: number) => {
      dicho = i
      l.nueva()
      if (!conVozRef.current || vozRef.current.tramos[i] !== 'navegador') return
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
    reanudar.current = () => {
      if (p.isPlaying()) alTocar()
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
      reanudar.current = () => undefined
      l.parar()
    }
  }, [hayNavegador, desde, linea])

  // Mientras suena, pulsar en la imagen lo pausa; parado, los botones de la escena se pueden tocar. Se mira el clic
  // antes de que llegue a la escena (fase de captura) y solo si cae en la imagen: la barra de controles y el menú de
  // velocidad, que se abre encima de la imagen, son del Player. Vale también en pantalla completa.
  const [tocando, setTocando] = useState(false)
  useEffect(() => {
    const p = player.current
    if (!p) return
    const si = () => setTocando(true)
    const no = () => setTocando(false)
    // Al acabar, el Player vuelve al fotograma 0, que es negro (el fundido de entrada): mejor la primera escena.
    const alAcabar = () => {
      no()
      p.seekTo(primero)
    }
    p.addEventListener('play', si)
    p.addEventListener('pause', no)
    p.addEventListener('ended', alAcabar)
    return () => {
      p.removeEventListener('play', si)
      p.removeEventListener('pause', no)
      p.removeEventListener('ended', alAcabar)
    }
  }, [primero])
  const pausarAlPulsar = (e: Pulsacion) => {
    if (!player.current?.isPlaying() || !(e.target as Element).closest?.('.escena-lienzo')) return
    e.stopPropagation()
    e.preventDefault()
    player.current.pause()
  }

  const props: PropsComposicion = useMemo(() => ({ guion, subtitulos, ritmo: ritmoLinea, medidas, audios }), [guion, subtitulos, ritmoLinea, medidas, audios])

  const cambiarVoz = (si: boolean) => {
    if (si) {
      player.current?.unmute()
      if (player.current?.getVolume() === 0) player.current.setVolume(1) // «Voz» marcada tiene que sonar
    } else player.current?.mute()
    ponerVoz(si)
  }
  const cambiarVozRef = useRef(cambiarVoz)
  useEffect(() => {
    cambiarVozRef.current = cambiarVoz
  })

  // Las teclas de cualquier reproductor (teclas.ts), con el foco en cualquier sitio de la página, salvo al escribir o
  // si la tecla es del botón que tiene el foco. Las de Remotion no valen: para funcionar mueve el foco a su botón
  // cada vez que el vídeo arranca o se para, y se lo quitaba a la caja en la que estuvieras escribiendo.
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      const p = player.current
      const accion = accionDeTecla(e, e.target as Element | null)
      if (!p || !accion) return
      e.preventDefault()
      // Mantener pulsada ← o → sigue saltando; lo demás va de una en una.
      if (e.repeat && accion !== 'atras' && accion !== 'adelante') return
      if (accion === 'tocar') p.toggle(e as unknown as SyntheticEvent) // con el evento, el Player lo toma como gesto y desbloquea sus audios
      else if (accion === 'silencio') cambiarVozRef.current(!conVozRef.current)
      else if (accion === 'pantalla') {
        if (p.isFullscreen()) p.exitFullscreen()
        else p.requestFullscreen()
      } else {
        const destino = fotogramaTrasTecla(accion, p.getCurrentFrame(), desde, total, FPS)
        if (destino === null) return
        p.seekTo(destino)
        setActual(tramoEn(desde, destino))
      }
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [desde, total])

  // Al ocultar la pestaña (o minimizar la ventana), se pausa; al volver no sigue sola.
  useEffect(() => {
    const oculto = () => {
      if (document.visibilityState === 'hidden') player.current?.pause()
    }
    document.addEventListener('visibilitychange', oculto)
    return () => document.removeEventListener('visibilitychange', oculto)
  }, [])

  return (
    <div className="escena">
      <div className="escena-pantalla">
        <div className={`escena-reproductor${tocando ? ' tocando' : ''}`} onClickCapture={pausarAlPulsar}>
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
          spaceKeyToPlayOrPause={false}
          allowFullscreen
          // El primer «reproducir» es tuyo (botón o espacio): con ese gesto el Player desbloquea sus etiquetas de audio
          // y las reutiliza para cada trozo de voz, así el navegador no bloquea los que empiezan después.
          numberOfSharedAudioTags={5}
          playbackRate={conMagister ? velocidad : 1}
          showPlaybackRateControl={conMagister ? VELOCIDADES : false}
          style={{ width: '100%', aspectRatio: `${ANCHO} / ${ALTO}`, borderRadius: 14, overflow: 'hidden' }}
        />
        {preparandoVoz && (
          <div
            role="status"
            style={{
              position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 10,
              padding: '6px 12px', borderRadius: 999, background: 'rgba(0,0,0,0.65)', color: '#fff', fontSize: 14,
            }}
          >
            <Pensando texto="Preparando la voz…" />
            <button type="button" className="boton-mini" onClick={sinEsperar}>
              Seguir con la del navegador
            </button>
          </div>
        )}
        </div>
        <div className="escena-ajustes">
          <label>
            <input type="checkbox" checked={conVoz} onChange={(e) => cambiarVoz(e.target.checked)} /> Voz
          </label>
          <label>
            <input type="checkbox" checked={subtitulos} onChange={(e) => setSubtitulos(e.target.checked)} /> Subtítulos
          </label>
          <span className="nota escena-teclas">{AYUDA_TECLAS}.</span>
          <span className="nota">Parado, la escena se puede tocar.</span>
          {avisoVoz(voz) && <span className="nota">{avisoVoz(voz)}</span>}
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
                onClick={(e) => {
                  player.current?.seekTo(verTramo(desde, i, total))
                  setActual(i)
                  // Con el ratón, el foco no se queda en la tesis: el espacio luego pausa en vez de volver a saltar.
                  // Con el teclado (detail 0) sí se queda, para seguir recorriendo la lista.
                  if (e.detail > 0) e.currentTarget.blur()
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
