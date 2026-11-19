import { useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { claveNota, localizar, type Duda, type Nota } from './dudas.ts'
import { HUECO_NOTA } from './parrafos.ts'

// Las dudas y las notas de la mascota de la idea que lees: la duda, un subrayado de puntos en su párrafo; la nota,
// plegada justo debajo de él (vuelve al releer). El texto lo pinta TextoLibro: aquí solo se añade una clase y un hueco
// al lado de cada párrafo con nota, que el párrafo activo no cuenta como unidad (parrafos.ts).

const ACCION: Record<string, string> = {
  facil: 'más fácil',
  ejemplo: 'con un ejemplo',
  porque: 'el porqué',
  clave: 'las palabras clave',
  codigo: 'el código, línea a línea',
  pregunta: 'tu pregunta',
}

interface Props {
  lista: HTMLElement[]
  clave: string
  dudas: Duda[]
  notas: Nota[]
  // Las recién explicadas se enseñan abiertas; las de otro día, plegadas.
  abiertas: ReadonlySet<string>
}

export default function NotasFoco({ lista, clave, dudas, notas, abiertas }: Props) {
  const [huecos, setHuecos] = useState<{ nota: Nota; hueco: HTMLElement }[]>([])

  // El subrayado de las dudas.
  useLayoutEffect(() => {
    const textos = lista.map((el) => el.innerText ?? el.textContent ?? '')
    const marcados = new Set(dudas.filter((d) => d.clave === clave).map((d) => localizar(textos, d.u, d.texto)))
    lista.forEach((el, k) => el.classList.toggle('duda', marcados.has(k)))
  }, [lista, clave, dudas])

  // Un hueco tras cada párrafo con nota.
  useLayoutEffect(() => {
    const textos = lista.map((el) => el.innerText ?? el.textContent ?? '')
    const nuevos: { nota: Nota; hueco: HTMLElement }[] = []
    for (const n of notas.filter((x) => x.clave === clave)) {
      const k = localizar(textos, n.u, n.texto)
      const el = lista[k]
      if (!el?.isConnected) continue
      const hueco = document.createElement('div')
      hueco.className = HUECO_NOTA
      el.insertAdjacentElement('afterend', hueco)
      nuevos.push({ nota: n, hueco })
    }
    setHuecos(nuevos)
    return () => nuevos.forEach((x) => x.hueco.remove())
  }, [lista, clave, notas])

  return (
    <>
      {huecos.map(({ nota, hueco }) =>
        createPortal(
          <details className="foco-nota" open={abiertas.has(claveNota(nota))}>
            <summary>La mascota te lo explicó así{ACCION[nota.accion] ? ` (${ACCION[nota.accion]})` : ''}</summary>
            <p>{nota.respuesta.replace(/\*\*/g, '')}</p>
          </details>,
          hueco,
          claveNota(nota),
        ),
      )}
    </>
  )
}
