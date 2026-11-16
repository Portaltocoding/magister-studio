import { useEffect, useRef, useState, type ReactNode } from 'react'

// Lectura media: unos 250 palabras por minuto, unos 23 caracteres por segundo.
// Vamos algo más rápido para que no se haga lento, y nunca más de unos segundos por detrás de lo que llega.
const CARACTERES_POR_SEGUNDO = 38
const RETRASO_MAXIMO_S = 5

interface Props {
  texto: string
  // Solo se anima lo que llega en directo; lo que ya estaba guardado sale entero.
  animar: boolean
  children: (visible: string) => ReactNode
}

// El texto del tutor aparece a ritmo de lectura, palabra a palabra, aunque el modelo lo mande a trozos.
export default function Revelar({ texto, animar, children }: Props) {
  const [mostrado, setMostrado] = useState(animar ? 0 : texto.length)
  const posicion = useRef(animar ? 0 : texto.length)
  // Una vez empieza a animarse sigue hasta alcanzar el final, aunque el flujo ya haya terminado.
  const animando = useRef(animar)
  if (animar) animando.current = true

  useEffect(() => {
    if (!animando.current || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      posicion.current = texto.length
      setMostrado(texto.length)
      return
    }
    let marco = 0
    let antes = performance.now()
    const paso = (ahora: number) => {
      const dt = Math.min(0.1, (ahora - antes) / 1000)
      antes = ahora
      const falta = texto.length - posicion.current
      if (falta <= 0) return
      const velocidad = Math.max(CARACTERES_POR_SEGUNDO, falta / RETRASO_MAXIMO_S)
      posicion.current = Math.min(texto.length, posicion.current + velocidad * dt)
      setMostrado(Math.floor(posicion.current))
      marco = requestAnimationFrame(paso)
    }
    marco = requestAnimationFrame(paso)
    return () => cancelAnimationFrame(marco)
  }, [texto])

  if (mostrado >= texto.length) return <>{children(texto)}</>
  // Corta en el último espacio para no enseñar media palabra, y cierra la negrita o el código abiertos.
  let corte = texto.lastIndexOf(' ', mostrado)
  if (corte <= 0) corte = mostrado
  let visible = texto.slice(0, corte)
  if ((visible.match(/\*\*/g) ?? []).length % 2) visible += '**'
  if ((visible.match(/```/g) ?? []).length % 2) {
    // Los bloques que se pulsan (opciones, test, pregunta, agendar) salen enteros o no salen: si no, un clic
    // a medio revelar mandaría el texto cortado.
    const inicio = visible.lastIndexOf('```')
    if (/^```(opciones|test|pregunta|agendar)\b/.test(visible.slice(inicio))) visible = visible.slice(0, inicio)
    else visible += '\n```'
  }
  else if ((visible.replace(/```/g, '').match(/`/g) ?? []).length % 2) visible += '`'
  if ((visible.match(/\$\$/g) ?? []).length % 2) visible = visible.slice(0, visible.lastIndexOf('$$'))
  return (
    <>
      {children(visible)}
      <span className="cursor-lectura" aria-hidden />
    </>
  )
}
