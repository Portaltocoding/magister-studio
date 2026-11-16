import { useCallback, useState, type FocusEvent, type PointerEvent } from 'react'

// El aviso de los gráficos: al pasar el ratón o con el foco del teclado, el valor delante y la etiqueta detrás.
// Nunca es la única forma de leer un dato: cada gráfico lleva también su tabla.

interface Contenido {
  valor: string
  etiqueta: string
}

interface Estado extends Contenido {
  x: number
  y: number
}

export function usarAviso() {
  const [aviso, setAviso] = useState<Estado | null>(null)

  const sobre = useCallback(
    (c: Contenido) => ({
      tabIndex: 0,
      'aria-label': `${c.etiqueta}: ${c.valor}`,
      onPointerMove: (e: PointerEvent) => setAviso({ ...c, x: e.clientX, y: e.clientY }),
      onPointerLeave: () => setAviso(null),
      onFocus: (e: FocusEvent) => {
        const r = (e.currentTarget as Element).getBoundingClientRect()
        setAviso({ ...c, x: r.left + r.width / 2, y: r.top })
      },
      onBlur: () => setAviso(null),
    }),
    [],
  )

  const nodo = aviso && (
    <div className="viz-aviso" role="tooltip" style={{ left: aviso.x, top: aviso.y }}>
      <strong>{aviso.valor}</strong>
      <span>{aviso.etiqueta}</span>
    </div>
  )
  return { sobre, nodo }
}
