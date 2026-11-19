import { useCallback, useEffect, useRef, useState } from 'react'
import { describir, elegirVoz, frasesDe, LectorFoco, PAUSA_MS, queDecir } from './lecturaVoz.ts'

// Leer en voz alta en el modo foco: lee el párrafo activo y, al acabar, espera un momento y pasa al siguiente (la
// marca del margen va con la voz). Si cambias de párrafo mientras lee (↑ ↓, un clic), sigue desde ahí. Se para al
// llegar al último párrafo de la idea (antes de la comprobación), al cambiar de idea o de pantalla, con P o con Esc.
export function usarLeerEnVoz(c: {
  lista: HTMLElement[]
  u: number
  mover: (d: number) => void
  clave: string
  // Solo en la pantalla de leer una idea.
  activa: boolean
  // Al llegar al final de la idea: lo que se dice al parar (y, si hay comprobación, se va a ella).
  alFinal?: () => string
}) {
  const { lista, u, mover, clave, activa } = c
  const [leyendo, setLeyendo] = useState(false)
  const [estado, setEstado] = useState('')
  const lector = useRef<LectorFoco | null>(null)
  const alFinal = useRef(c.alFinal)
  alFinal.current = c.alFinal

  const parar = useCallback((motivo = '') => {
    lector.current?.callar()
    setLeyendo(false)
    setEstado(motivo)
  }, [])

  const alternar = useCallback(async () => {
    if (leyendo) return parar()
    setEstado('Preparando la voz…')
    const voz = await elegirVoz()
    if (!voz) {
      setEstado('No hay voz local: instala las voces de Magister (Piper) o una voz en español en el sistema.')
      return
    }
    lector.current?.cerrar()
    lector.current = new LectorFoco(voz)
    setLeyendo(true)
  }, [leyendo, parar])

  // Lee la unidad activa; al acabar, la siguiente (cambiar u vuelve a pasar por aquí).
  useEffect(() => {
    if (!leyendo || !lector.current) return
    const el = lista[u]
    if (!el) return
    let vivo = true
    let espera = 0
    const q = queDecir(describir(el))
    setEstado(q.leer ? `Leyendo · párrafo ${u + 1} de ${lista.length} · P para parar` : `${q.texto}: no se lee`)
    void lector.current.decir(frasesDe(q)).then((acabo) => {
      if (!vivo || !acabo) return
      espera = window.setTimeout(() => {
        if (!vivo) return
        if (u >= lista.length - 1) parar(alFinal.current?.() ?? 'Fin de la idea')
        else mover(1)
      }, PAUSA_MS)
    })
    return () => {
      vivo = false
      window.clearTimeout(espera)
      lector.current?.callar()
    }
  }, [leyendo, u, lista, mover, parar])

  // Otra idea u otra pantalla: se para.
  useEffect(() => {
    if (leyendo) parar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave])
  useEffect(() => {
    if (!activa && leyendo) parar()
  }, [activa, leyendo, parar])
  useEffect(() => () => lector.current?.cerrar(), [])
  // Lo que dice al parar se queda un momento y se va.
  useEffect(() => {
    if (leyendo || !estado || estado === 'Preparando la voz…') return
    const t = window.setTimeout(() => setEstado(''), 5000)
    return () => window.clearTimeout(t)
  }, [leyendo, estado])

  return { leyendo, estado, alternar, parar }
}
