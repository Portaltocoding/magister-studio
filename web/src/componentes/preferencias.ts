import { useEffect, useState } from 'react'
import { enviarJson, pedir } from '../api.ts'
import { EVENTO_CONECTADO } from './Cargando.tsx'

// Las preferencias del tutor, compartidas entre la mascota, el selector de modo y las tarjetas del chat.
// Un cambio en un sitio se ve al momento en los demás.

export interface ModoAprendizaje {
  id: string
  nombre: string
  para: string
  reglas: string[]
}

export interface PreferenciasTutor {
  longitud: 'breve' | 'normal' | 'detallada'
  nivel: 'cero' | 'normal' | 'experto'
  estilo: 'directo' | 'analogias' | 'codigo'
  diagramas: boolean
  tests: boolean
  opciones: boolean
  idioma: 'es' | 'en'
  instrucciones: string[]
  modos: ModoAprendizaje[]
  modo: string | null
  modos_de_serie: ModoAprendizaje[]
}

const EVENTO = 'magister-preferencias'
let cache: PreferenciasTutor | null = null

export async function cargarPreferencias(): Promise<PreferenciasTutor> {
  cache = await pedir<PreferenciasTutor>('/api/preferencias')
  return cache
}

export async function cambiarPreferencias(cambio: Partial<PreferenciasTutor>): Promise<PreferenciasTutor> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { modos_de_serie, ...resto } = cambio as PreferenciasTutor
  cache = await pedir<PreferenciasTutor>('/api/preferencias', enviarJson(resto, 'PUT'))
  window.dispatchEvent(new CustomEvent(EVENTO, { detail: cache }))
  return cache
}

export function usarPreferencias(): PreferenciasTutor | null {
  const [p, setP] = useState<PreferenciasTutor | null>(cache)
  useEffect(() => {
    // Si falla (el servidor se está reiniciando), se vuelve a pedir cuando la barra avisa de que ha vuelto.
    const cargar = () => {
      if (!cache) cargarPreferencias().then(setP).catch(() => undefined)
    }
    cargar()
    const al = (e: Event) => setP((e as CustomEvent<PreferenciasTutor>).detail)
    window.addEventListener(EVENTO, al)
    window.addEventListener(EVENTO_CONECTADO, cargar)
    return () => {
      window.removeEventListener(EVENTO, al)
      window.removeEventListener(EVENTO_CONECTADO, cargar)
    }
  }, [])
  return p
}

export const todosLosModos = (p: PreferenciasTutor) => [...p.modos_de_serie, ...p.modos]

export function idDeModo(nombre: string, usados: string[]): string {
  const base =
    nombre
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 40) || 'modo'
  let id = base
  for (let i = 2; usados.includes(id); i++) id = `${base}_${i}`
  return id
}

// Pone un texto en el cuadro del chat para que lo completes.
export const escribirEnChat = (texto: string) => window.dispatchEvent(new CustomEvent('magister-escribir', { detail: texto }))
