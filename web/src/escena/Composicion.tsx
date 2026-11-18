// La composición de Remotion: los tramos en fila, cada uno con su título, su escena y su subtítulo.
// Vídeo = f(fotograma): nada guarda estado del tiempo, así que se puede saltar a cualquier punto.
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame } from 'remotion'
import { C } from './estilo.ts'
import { EscenaContraste, EscenaOpciones, EscenaPorDentro, EscenaPregunta, EscenaTablero } from './escenas.tsx'
import { EscenaArbol, EscenaBarras, EscenaConsulta, EscenaIndice, EscenaMitades, EscenaPasos, EscenaTabla } from './escenas_datos.tsx'
import { EscenaCalculo, EscenaFigura, EscenaFormula } from './escenas_geo.tsx'
import { Subtitulo, Titulo } from './piezas.tsx'
import { duracionTramo, frases, inicios, type GuionGrafico, type Tramo } from './tipos.ts'

export interface PropsComposicion {
  guion: GuionGrafico
  subtitulos: boolean
  // Remotion pide que las props de una composición sean un objeto indexable.
  [clave: string]: unknown
}

export function Composicion({ guion, subtitulos }: PropsComposicion) {
  const desde = inicios(guion)
  return (
    <AbsoluteFill style={{ background: C.fondo }}>
      {guion.tramos.map((t, i) => (
        <Sequence key={i} from={desde[i]} durationInFrames={duracionTramo(t)} name={`${t.concepto} · ${t.tesis}`}>
          <VistaTramo tramo={t} subtitulos={subtitulos} />
        </Sequence>
      ))}
    </AbsoluteFill>
  )
}

// Las frases de la narración, repartidas por el tramo según lo que cuesta decir cada una.
function fraseEn(narracion: string, frame: number, dur: number): string {
  const lista = frases(narracion)
  const pesos = lista.map((f) => f.split(/\s+/).length)
  const total = pesos.reduce((a, b) => a + b, 0)
  let acumulado = 0
  for (let i = 0; i < lista.length; i++) {
    acumulado += pesos[i]
    if (frame < (acumulado / total) * (dur - 20)) return lista[i]
  }
  return lista[lista.length - 1] ?? ''
}

function VistaTramo({ tramo, subtitulos }: { tramo: Tramo; subtitulos: boolean }) {
  const frame = useCurrentFrame()
  const dur = duracionTramo(tramo)
  // Sin cortes duros: cada tramo nace y se va con un fundido corto.
  const opacidad = interpolate(frame, [0, 8, dur - 8, dur], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const e = tramo.escena
  return (
    <AbsoluteFill style={{ opacity: opacidad }}>
      <Titulo concepto={tramo.concepto} tesis={tramo.tesis} />
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
      {subtitulos && <Subtitulo texto={fraseEn(tramo.narracion, frame, dur)} />}
    </AbsoluteFill>
  )
}
