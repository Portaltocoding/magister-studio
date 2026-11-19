// El párrafo activo del modo foco: qué cuenta como unidad de lectura, cómo se pasa de una a otra con el teclado y cómo
// se sigue la lectura cuando desplazas tú. El ratón por encima no cambia nada: solo el teclado, un clic o terminar de
// desplazar. Las funciones de arriba son puras (con pruebas en web/pruebas/parrafos.test.ts); el hook, al final.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { aCss } from './escala.ts'

// Lo mínimo de un elemento que hace falta para decidir las unidades (un Element lo cumple; en las pruebas, un objeto).
export interface Nodo {
  tagName: string
  textContent: string | null
  children: ArrayLike<Nodo>
  classList: { contains(c: string): boolean }
  querySelector(s: string): unknown
  setAttribute(n: string, v: string): void
}

const SALTAR = new Set(['H1', 'H2', 'H3', 'H4', 'HR'])
const LISTAS = new Set(['UL', 'OL'])

const tieneContenido = (n: Nodo) => !!n.textContent?.trim() || !!n.querySelector('svg, img, table')

// Las unidades de lectura: los hijos directos del papel (p, pre, blockquote, table, figure, fórmulas en bloque y las
// cajas del libro cuentan como una cada uno), salvo títulos y rayas; en una lista, cada elemento directo es una unidad
// (una sublista va con su elemento). Fuera las vacías. A cada una se le pone data-u y tabindex=-1.
export function unidades<T extends Nodo>(papel: { children: ArrayLike<T> }): T[] {
  const lista: T[] = []
  for (const hijo of Array.from(papel.children)) {
    const etiqueta = hijo.tagName.toUpperCase()
    if (SALTAR.has(etiqueta)) continue
    if (LISTAS.has(etiqueta)) {
      for (const li of Array.from(hijo.children)) if (li.tagName.toUpperCase() === 'LI' && tieneContenido(li)) lista.push(li as T)
      continue
    }
    if (tieneContenido(hijo)) lista.push(hijo)
  }
  lista.forEach((el, k) => {
    el.setAttribute('data-u', String(k))
    el.setAttribute('tabindex', '-1')
  })
  return lista
}

export const siguiente = (u: number, n: number) => Math.max(0, Math.min(u + 1, n - 1))
export const anterior = (u: number) => Math.max(0, u - 1)

// La unidad cuyo [top, bottom] contiene la línea; si ninguna, la más cercana. -1 si no hay unidades.
export function elegirPorLinea(rects: { top: number; bottom: number }[], linea: number): number {
  let mejor = -1
  let dist = Infinity
  for (let k = 0; k < rects.length; k++) {
    const r = rects[k]
    if (r.top <= linea && linea <= r.bottom) return k
    const d = Math.min(Math.abs(r.top - linea), Math.abs(r.bottom - linea))
    if (d < dist) {
      dist = d
      mejor = k
    }
  }
  return mejor
}

export type Pantalla = 'idea' | 'calentamiento' | 'reexplicar' | 'descanso' | 'cierre'

export interface TeclaFoco {
  key: string
  isComposing?: boolean
  defaultPrevented?: boolean
  altKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  target: unknown
}

const CAMPOS = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])'
const CAJAS = '.companera-bocadillo, .foco-ajustes-caja, .foco-glosario, .foco-mapa, [role="dialog"]:not(.foco)'
const PULSABLES = 'button, a, [role="button"]'

// Si la tecla no es del modo foco: escribes, es un atajo del navegador, estás en una caja que tiene sus teclas, o la
// pantalla no es la de leer una idea.
export function debeIgnorar(e: TeclaFoco, ctx: { pantalla: Pantalla; menuAbierto: boolean }): boolean {
  if (e.isComposing || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return true
  const t = e.target as { closest?: (s: string) => unknown } | null
  const cerca = (s: string) => !!t?.closest?.(s)
  if (cerca(CAMPOS) || cerca(CAJAS)) return true
  if ((e.key === ' ' || e.key === 'Enter') && cerca(PULSABLES)) return true
  return ctx.pantalla !== 'idea' || ctx.menuAbierto
}

// Dónde dejar el desplazamiento para que una unidad se lea entera: null si ya cabe entre el 12 % y el 88 % del alto
// de la zona; si no, el scrollTop que pone su borde de arriba al 35 %. `escala`: píxeles de pantalla por píxel de
// desplazamiento (el zoom de la interfaz).
export function destinoScroll(
  unidad: { top: number; bottom: number },
  zona: { top: number; height: number },
  scrollTop: number,
  escala = 1,
): number | null {
  const arriba = zona.top + zona.height * 0.12
  const abajo = zona.top + zona.height * 0.88
  if (unidad.top >= arriba && unidad.bottom <= abajo) return null
  return Math.max(0, scrollTop + (unidad.top - (zona.top + zona.height * 0.35)) / (escala || 1))
}

// easeOutQuart: rápido al principio y se posa despacio.
export const curva = (t: number) => 1 - (1 - t) ** 4

// Mientras un desplazamiento lo hace el código, el seguimiento de la lectura no cuenta (y hasta 50 ms después).
let programado = false
let quitar = 0
let marco = 0
export const estaProgramado = () => programado

export function desplazarA(cuerpo: HTMLElement, top: number, ms = 420) {
  cancelAnimationFrame(marco)
  window.clearTimeout(quitar)
  programado = true
  const fin = () => {
    quitar = window.setTimeout(() => {
      programado = false
    }, 50)
  }
  const destino = Math.max(0, Math.min(top, cuerpo.scrollHeight - cuerpo.clientHeight))
  const quieto = ms <= 0 || !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const desde = cuerpo.scrollTop
  if (quieto || Math.abs(destino - desde) < 1) {
    cuerpo.scrollTop = destino
    fin()
    return
  }
  const t0 = performance.now()
  const paso = (ahora: number) => {
    const t = Math.min(1, (ahora - t0) / ms)
    cuerpo.scrollTop = desde + (destino - desde) * curva(t)
    if (t < 1) marco = requestAnimationFrame(paso)
    else fin()
  }
  marco = requestAnimationFrame(paso)
}

// Si la unidad no se lee entera, la trae al 35 % de la zona.
function asegurarVisible(el: HTMLElement, cuerpo: HTMLElement, ms = 420) {
  const zona = cuerpo.getBoundingClientRect()
  const r = el.getBoundingClientRect()
  const destino = destinoScroll(r, zona, cuerpo.scrollTop, cuerpo.offsetHeight ? zona.height / cuerpo.offsetHeight : 1)
  if (destino != null) desplazarA(cuerpo, destino, ms)
}

export interface Marca {
  top: number
  height: number
}

// El párrafo activo de una idea. `papel`: la envoltura del papel (dentro está .foco-papel y ahí va la marca);
// `cuerpo`: la zona que se desplaza. `inicial`: la unidad por la que empezar (la que guardaste al salir).
// Lo que el ratón tiene que quedarse en un párrafo para activarlo.
const ESPERA_RATON_MS = 400

export function usarParrafoActivo(papel: HTMLElement | null, cuerpo: HTMLElement | null, claveIdea: string, inicial?: number | null) {
  const [u, setU] = useState(0)
  const [lista, setLista] = useState<HTMLElement[]>([])
  const [marca, setMarca] = useState<Marca | null>(null)
  const uRef = useRef(0)
  uRef.current = u
  const listaRef = useRef<HTMLElement[]>([])
  listaRef.current = lista
  const ultimoScroll = useRef(0)
  // Si el papel se vuelve a montar con la misma idea (al volver de un descanso), se sigue donde ibas.
  const ultima = useRef<{ clave: string; u: number } | null>(null)
  const claveLista = useRef('')

  useLayoutEffect(() => {
    const hoja = papel?.isConnected ? papel.querySelector<HTMLElement>('.foco-papel') : null
    if (!hoja) {
      setLista([])
      return
    }
    const l = unidades(hoja) as HTMLElement[]
    claveLista.current = claveIdea
    const previa = ultima.current?.clave === claveIdea ? ultima.current.u : (inicial ?? 0)
    const n = Math.max(0, Math.min(previa, l.length - 1))
    setLista(l)
    setU(n)
    l[n]?.focus({ preventScroll: true })
    if (cuerpo) {
      if (n > 0 && l[n]) asegurarVisible(l[n], cuerpo, 0)
      else desplazarA(cuerpo, 0, 0)
    }
    // Si el texto se vuelve a pintar (llega el glosario, una fórmula…), las unidades se rehacen sin mover nada.
    let pendiente = 0
    const obs = new MutationObserver(() => {
      if (pendiente) return
      pendiente = requestAnimationFrame(() => {
        pendiente = 0
        const nueva = unidades(hoja) as HTMLElement[]
        const igual = nueva.length === listaRef.current.length && nueva.every((el, k) => el === listaRef.current[k])
        if (igual) return
        setLista(nueva)
        setU((x) => Math.max(0, Math.min(x, nueva.length - 1)))
      })
    })
    obs.observe(hoja, { childList: true, subtree: true })
    return () => {
      obs.disconnect()
      cancelAnimationFrame(pendiente)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [papel, cuerpo, claveIdea])

  // La clase .activo, solo en la unidad activa.
  useLayoutEffect(() => {
    lista.forEach((el, k) => el.classList.toggle('activo', k === u))
    if (lista.length) ultima.current = { clave: claveLista.current, u }
  }, [lista, u])

  // La marca del margen: a la altura de la unidad activa, medida con getBoundingClientRect (nunca offsetTop).
  const medir = useCallback(() => {
    const el = lista[u]
    if (!el || !papel || !el.isConnected) {
      setMarca(null)
      return
    }
    const a = papel.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    const nueva = { top: Math.round(aCss(r.top - a.top)), height: Math.round(aCss(r.height)) }
    setMarca((m) => (m && m.top === nueva.top && m.height === nueva.height ? m : nueva))
  }, [lista, u, papel])

  useLayoutEffect(() => {
    medir()
    if (!papel || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => medir())
    ro.observe(papel)
    return () => ro.disconnect()
  }, [medir, papel])

  // Al terminar de desplazar tú (rueda, trackpad, AvPág o la barra): la unidad que cruza la línea del 35 %.
  useEffect(() => {
    if (!cuerpo) return
    let rafaga = false
    let delCodigo = false
    let t = 0
    let rueda = 0
    const acabar = () => {
      window.clearTimeout(t)
      if (!rafaga) return
      // Entre dos golpes de rueda también llega un scrollend: hasta que la rueda no para, no se elige.
      if (Date.now() - rueda < 150) {
        t = window.setTimeout(acabar, 150)
        return
      }
      const ignorar = delCodigo || programado
      rafaga = false
      delCodigo = false
      if (ignorar) return
      const l = listaRef.current
      if (!l.length) return
      const zona = cuerpo.getBoundingClientRect()
      const k = elegirPorLinea(
        l.map((el) => el.getBoundingClientRect()),
        zona.top + zona.height * 0.35,
      )
      if (k >= 0) setU(k)
    }
    const alDesplazar = () => {
      ultimoScroll.current = Date.now()
      rafaga = true
      if (programado) delCodigo = true
      window.clearTimeout(t)
      t = window.setTimeout(acabar, 150)
    }
    const alRodar = () => {
      rueda = Date.now()
    }
    cuerpo.addEventListener('scroll', alDesplazar, { passive: true })
    cuerpo.addEventListener('scrollend', acabar)
    cuerpo.addEventListener('wheel', alRodar, { passive: true })
    return () => {
      window.clearTimeout(t)
      cuerpo.removeEventListener('scroll', alDesplazar)
      cuerpo.removeEventListener('scrollend', acabar)
      cuerpo.removeEventListener('wheel', alRodar)
    }
  }, [cuerpo])

  // Un clic en una unidad la hace activa (salvo en un enlace, un botón o un campo, o si estás seleccionando texto).
  useEffect(() => {
    if (!papel) return
    const clic = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null
      if (!t || t.closest('a, button, input, textarea, select')) return
      if ((window.getSelection()?.toString() ?? '').trim()) return
      const el = t.closest<HTMLElement>('[data-u]')
      const k = el ? listaRef.current.indexOf(el) : -1
      if (k >= 0) setU(k)
    }
    // El ratón también la activa, pero solo si se queda en la misma unidad un momento: cruzar el papel no cambia nada.
    let espera = 0
    let candidata: HTMLElement | null = null
    const soltar = () => {
      window.clearTimeout(espera)
      candidata = null
    }
    const mover = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null
      const el = t?.closest<HTMLElement>('[data-u]') ?? null
      if (el === candidata) return
      soltar()
      if (!el || el.classList.contains('activo')) return
      candidata = el
      espera = window.setTimeout(() => {
        const k = listaRef.current.indexOf(el)
        const quieto = Date.now() - ultimoScroll.current > ESPERA_RATON_MS
        if (candidata === el && k >= 0 && quieto && !(window.getSelection()?.toString() ?? '').trim()) setU(k)
        candidata = null
      }, ESPERA_RATON_MS)
    }
    const conRaton = typeof window.matchMedia !== 'function' || window.matchMedia('(hover: hover)').matches
    papel.addEventListener('click', clic)
    if (conRaton) {
      papel.addEventListener('mousemove', mover, { passive: true })
      papel.addEventListener('mouseleave', soltar)
    }
    return () => {
      soltar()
      papel.removeEventListener('click', clic)
      papel.removeEventListener('mousemove', mover)
      papel.removeEventListener('mouseleave', soltar)
    }
  }, [papel])

  const ir = useCallback(
    (n: number) => {
      const l = listaRef.current
      if (!l.length) return
      const k = Math.max(0, Math.min(n, l.length - 1))
      setU(k)
      l[k].focus({ preventScroll: true })
      if (cuerpo) asegurarVisible(l[k], cuerpo)
    },
    [cuerpo],
  )
  const mover = useCallback(
    (d: number) => ir(d > 0 ? siguiente(uRef.current, listaRef.current.length) : d < 0 ? anterior(uRef.current) : uRef.current),
    [ir],
  )

  return { u, unidades: lista, mover, ir, marca, ultimoScroll }
}
