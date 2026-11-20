import { useCallback, useEffect, useState, type RefObject } from 'react'
import { EVENTO_NOTAS, guardarNota, listarNotas } from '../api.ts'
import { aCss } from './escala.ts'
import { t } from '../i18n/i18n.ts'
import { usarIdioma } from '../i18n/usarIdioma.ts'

// Guardar lo que te interesa de Estudio libre en «Mis notas»: la respuesta entera (botón bajo cada una)
// o solo el trozo que marques con el ratón o el teclado.

const avisar = () => window.dispatchEvent(new Event(EVENTO_NOTAS))

// Qué respuestas ya están guardadas enteras: el botón sale como «En mis notas».
export function usarGuardadas(activo: boolean): Set<number> {
  const [ids, setIds] = useState<Set<number>>(new Set())
  useEffect(() => {
    if (!activo) return
    const cargar = () =>
      listarNotas()
        .then((ns) => setIds(new Set(ns.filter((n) => n.completa && n.mensaje_id != null).map((n) => n.mensaje_id as number))))
        .catch(() => undefined)
    cargar()
    window.addEventListener(EVENTO_NOTAS, cargar)
    return () => window.removeEventListener(EVENTO_NOTAS, cargar)
  }, [activo])
  return ids
}

export function BotonGuardar({ mensajeId, texto, guardada }: { mensajeId: number; texto: string; guardada: boolean }) {
  usarIdioma()
  const [estado, setEstado] = useState<'listo' | 'guardando' | 'error'>('listo')
  if (guardada)
    return (
      <a className="guardar-nota guardada" href="#/notas" title={t('nota.abrir')}>
        {t('nota.enMisNotas')}
      </a>
    )
  return (
    <button
      type="button"
      className="guardar-nota"
      disabled={estado === 'guardando'}
      title={t('nota.titulo')}
      onClick={async () => {
        setEstado('guardando')
        try {
          await guardarNota({ texto, mensaje_id: mensajeId, completa: true })
          setEstado('listo')
          avisar()
        } catch {
          setEstado('error')
        }
      }}
    >
      {estado === 'guardando' ? t('nota.guardando') : estado === 'error' ? t('nota.reintentar') : t('nota.guardar')}
    </button>
  )
}

interface Marcado {
  texto: string
  mensajeId: number | null
  x: number
  y: number
  debajo: boolean // sin sitio encima (el principio de lo marcado queda arriba, fuera de la vista): va debajo
}

// Al marcar texto dentro de una respuesta del tutor sale un botón flotante encima: «Guardar lo marcado».
export function GuardarMarcado({ zona }: { zona: RefObject<HTMLElement | null> }) {
  usarIdioma()
  const [marcado, setMarcado] = useState<Marcado | null>(null)
  const [hecho, setHecho] = useState(false)

  const leer = useCallback(() => {
    const sel = window.getSelection()
    const texto = sel?.toString().trim() ?? ''
    if (!sel || sel.isCollapsed || texto.length < 3 || !sel.rangeCount) return setMarcado(null)
    const nodo = sel.getRangeAt(0).commonAncestorContainer
    const el = nodo instanceof Element ? nodo : nodo.parentElement
    const burbuja = el?.closest<HTMLElement>('.burbuja-tutor')
    if (!burbuja || !zona.current?.contains(burbuja)) return setMarcado(null)
    const caja = sel.getRangeAt(0).getBoundingClientRect()
    const id = Number(burbuja.dataset.mensaje)
    // Siempre a la vista: encima de lo marcado si cabe; si no, debajo; y si tampoco, pegado arriba.
    const MARGEN = 70
    const x = Math.min(Math.max(caja.left + caja.width / 2, 100), window.innerWidth - 100)
    const encima = caja.top >= MARGEN && caja.top <= window.innerHeight - MARGEN
    const finAVista = caja.bottom >= MARGEN && caja.bottom <= window.innerHeight - MARGEN
    const y = encima ? caja.top : finAVista ? caja.bottom : MARGEN
    setHecho(false)
    setMarcado({ texto, mensajeId: Number.isFinite(id) && id > 0 ? id : null, x, y, debajo: !encima })
  }, [zona])

  useEffect(() => {
    const z = zona.current
    if (!z) return
    // Al soltar el ratón o terminar de marcar con el teclado (Mayús + flechas).
    const alSoltar = () => window.setTimeout(leer, 0)
    const alCambiar = () => {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed) setMarcado(null)
    }
    const alDesplazar = () => setMarcado(null)
    z.addEventListener('mouseup', alSoltar)
    z.addEventListener('keyup', alSoltar)
    document.addEventListener('selectionchange', alCambiar)
    const central = z.closest('.central')
    central?.addEventListener('scroll', alDesplazar, { passive: true })
    return () => {
      z.removeEventListener('mouseup', alSoltar)
      z.removeEventListener('keyup', alSoltar)
      document.removeEventListener('selectionchange', alCambiar)
      central?.removeEventListener('scroll', alDesplazar)
    }
  }, [zona, leer])

  if (!marcado) return null
  return (
    <button
      type="button"
      className={`guardar-marcado ${hecho ? 'hecho' : ''} ${marcado.debajo ? 'debajo' : ''}`}
      style={{ left: aCss(marcado.x), top: aCss(marcado.y) }}
      // Sin esto, pulsar el botón quitaría la selección antes del clic.
      onMouseDown={(e) => e.preventDefault()}
      onClick={async () => {
        try {
          await guardarNota({ texto: marcado.texto, mensaje_id: marcado.mensajeId })
          setHecho(true)
          avisar()
          window.setTimeout(() => {
            window.getSelection()?.removeAllRanges()
            setMarcado(null)
          }, 900)
        } catch {
          setMarcado(null)
        }
      }}
    >
      {hecho ? t('nota.guardadoMarcado') : t('nota.guardarMarcado')}
    </button>
  )
}
