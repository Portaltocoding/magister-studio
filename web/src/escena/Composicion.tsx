// La composición de Remotion: los tramos en fila, cada uno con su título, su escena, su subtítulo y su voz.
// Vídeo = f(fotograma): nada guarda estado del tiempo, así que se puede saltar a cualquier punto.
import { useMemo } from 'react'
import { AbsoluteFill, Html5Audio, Sequence, useCurrentFrame } from 'remotion'
import { C, rampa } from './estilo.ts'
import { EscenaContraste, EscenaOpciones, EscenaPorDentro, EscenaPregunta, EscenaTablero } from './escenas.tsx'
import { EscenaArbol, EscenaBarras, EscenaConsulta, EscenaIndice, EscenaMitades, EscenaPasos, EscenaTabla } from './escenas_datos.tsx'
import { EscenaCalculo, EscenaFigura, EscenaFormula } from './escenas_geo.tsx'
import { Subtitulo, Titulo } from './piezas.tsx'
import { SOLAPE, fraseEn, frases, lineaDeTiempo, type GuionGrafico, type Medidas, type Tramo, type TrozoEnLinea } from './tipos.ts'

export interface PropsComposicion {
  guion: GuionGrafico
  subtitulos: boolean
  // Sin voz medida, la velocidad de voz (1 = normal): alarga o acorta los tramos estimados para que vayan con la narración.
  ritmo?: number
  // Con la voz de Magister: cuánto dura cada trozo de cada tramo (s) y su audio. Sin ellas, los tiempos se estiman.
  medidas?: Medidas | null
  // Un tramo a null: aún sin su voz (dura la estimación) o con la del navegador, que va por fuera.
  audios?: ((string | null)[] | null)[] | null
  // Remotion pide que las props de una composición sean un objeto indexable.
  [clave: string]: unknown
}

// Una rejilla suave de fondo, al estilo de 3Blue1Brown, para los vídeos de matemáticas y ciencias. Las figuras pintan
// la suya, alineada con las coordenadas de verdad.
function FondoCartesiano() {
  const lineas = (n: number, paso: number) => Array.from({ length: n }, (_, i) => i * paso)
  return (
    <svg style={{ position: 'absolute', inset: 0 }} width="1280" height="720" aria-hidden>
      {lineas(21, 64).map((x) => (
        <line key={`v${x}`} x1={x} y1={0} x2={x} y2={720} stroke="#2f6a86" strokeWidth={1} opacity={x === 640 ? 0.22 : 0.1} />
      ))}
      {lineas(12, 64).map((y) => (
        <line key={`h${y}`} x1={0} y1={y + 40} x2={1280} y2={y + 40} stroke="#2f6a86" strokeWidth={1} opacity={y + 40 === 360 ? 0.22 : 0.1} />
      ))}
    </svg>
  )
}

export function Composicion({ guion, subtitulos, ritmo = 1, medidas = null, audios = null }: PropsComposicion) {
  // La misma línea de tiempo que usa el Player para su duración y sus saltos.
  const linea = useMemo(() => lineaDeTiempo(guion, ritmo, medidas), [guion, ritmo, medidas])
  return (
    // `escena-lienzo`: la imagen, para que el reproductor distinga un clic en ella de uno en sus controles.
    <AbsoluteFill className="escena-lienzo" style={{ background: C.fondo }}>
      {guion.fondo === 'cartesiano' && <FondoCartesiano />}
      {guion.tramos.map((t, i) => {
        const l = linea.tramos[i]
        return (
          <Sequence key={i} from={l.desde} durationInFrames={l.dur} name={`${t.concepto} · ${t.tesis}`}>
            <VistaTramo
              tramo={t}
              dur={l.dur}
              trozos={l.trozos}
              subtitulos={subtitulos}
              mismoAntes={guion.tramos[i - 1]?.concepto === t.concepto}
              mismoDespues={guion.tramos[i + 1]?.concepto === t.concepto}
            />
            {/* La voz, trozo a trozo y en su fotograma: pausar, saltar y la velocidad del Player la llevan con la imagen. */}
            {l.trozos.map((z, k) => {
              const src = audios?.[i]?.[k]
              return src && z.dur > 0 ? (
                <Sequence key={`voz${k}`} from={z.desde} durationInFrames={z.dur} layout="none" name={z.texto}>
                  <Html5Audio src={src} pauseWhenBuffering />
                </Sequence>
              ) : null
            })}
          </Sequence>
        )
      })}
    </AbsoluteFill>
  )
}

function VistaTramo({
  tramo, dur, trozos, subtitulos, mismoAntes, mismoDespues,
}: { tramo: Tramo; dur: number; trozos: TrozoEnLinea[]; subtitulos: boolean; mismoAntes: boolean; mismoDespues: boolean }) {
  const frame = useCurrentFrame()
  // Sin cortes: cada tramo entra mientras el anterior sale (fundido cruzado de SOLAPE fotogramas).
  const entra = rampa(frame, [0, SOLAPE], [0, 1])
  const sale = rampa(frame, [dur - SOLAPE, dur], [1, 0])
  const opacidad = entra * sale
  // El concepto no se funde si el tramo de al lado tiene el mismo: el que entra lo pinta igual y en el mismo sitio.
  const opacidadConcepto = (mismoAntes ? 1 : entra) * (mismoDespues ? (frame < dur - SOLAPE ? 1 : 0) : sale)
  const e = tramo.escena
  return (
    <>
      <Titulo concepto={tramo.concepto} tesis={tramo.tesis} entraConcepto={!mismoAntes} opacidad={opacidad} opacidadConcepto={opacidadConcepto} />
      <AbsoluteFill style={{ opacity: opacidad }}>
        {e.tipo === 'tablero' && <EscenaTablero e={e} />}
        {e.tipo === 'por_dentro' && <EscenaPorDentro e={e} dur={dur} />}
        {e.tipo === 'pregunta' && <EscenaPregunta e={e} />}
        {e.tipo === 'contraste' && <EscenaContraste e={e} dur={dur} />}
        {e.tipo === 'opciones' && <EscenaOpciones e={e} dur={dur} />}
        {e.tipo === 'tabla' && <EscenaTabla e={e} dur={dur} />}
        {e.tipo === 'indice' && <EscenaIndice e={e} dur={dur} />}
        {e.tipo === 'mitades' && <EscenaMitades e={e} dur={dur} />}
        {e.tipo === 'arbol' && <EscenaArbol e={e} dur={dur} />}
        {e.tipo === 'barras' && <EscenaBarras e={e} />}
        {e.tipo === 'consulta' && <EscenaConsulta e={e} dur={dur} />}
        {e.tipo === 'pasos' && <EscenaPasos e={e} dur={dur} />}
        {e.tipo === 'figura' && <EscenaFigura e={e} dur={dur} />}
        {e.tipo === 'formula' && <EscenaFormula e={e} dur={dur} />}
        {e.tipo === 'calculo' && <EscenaCalculo e={e} dur={dur} />}
        {/* Cada frase sale cuando empieza a sonar (con la voz medida) o cuando tocaría decirla (con la estimación). */}
        {subtitulos && frame >= SOLAPE && <Subtitulo texto={frases(tramo.narracion)[fraseEn(trozos, frame)] ?? ''} />}
      </AbsoluteFill>
    </>
  )
}
