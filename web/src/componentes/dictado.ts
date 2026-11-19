// Dictar la respuesta de una comprobación «hablada» del modo foco. Magister no tiene transcripción local: se usa el
// reconocimiento del navegador, que en Chrome manda el audio a los servidores de Google. Por eso viene apagado y la
// primera vez se pregunta; la respuesta se recuerda. Lo de arriba es puro (pruebas en web/pruebas/dictado.test.ts).
import { useCallback, useEffect, useRef, useState } from 'react'
import { Reconocedor, type Reconocimiento } from './voz.ts'

export const AVISO_DICTADO = 'Para dictar, el audio sale de tu ordenador hacia el servicio de voz del navegador (en Chrome, los servidores de Google).'

const CLAVE = 'magister-dictado'
type Permiso = 'si' | 'no' | null

interface Almacen {
  getItem(k: string): string | null
  setItem(k: string, v: string): void
}

// Sin respuesta guardada, null: se pregunta al pulsar «Dictar».
export function leerPermisoDictado(almacen: Almacen | null | undefined): Permiso {
  try {
    const v = almacen?.getItem(CLAVE)
    return v === 'si' || v === 'no' ? v : null
  } catch {
    return null
  }
}

export function guardarPermisoDictado(almacen: Almacen | null | undefined, v: 'si' | 'no') {
  try {
    almacen?.setItem(CLAVE, v)
  } catch {
    /* sin almacenamiento: vale para esta sesión */
  }
}

// Lo dictado se añade a lo que ya había escrito, con un espacio entre medias.
export function unirDictado(base: string, dicho: string): string {
  const d = dicho.trim()
  if (!d) return base
  if (!base.trim()) return d
  return `${base.replace(/\s+$/, '')} ${d}`
}

// Lo que se ve en la caja mientras hablas: lo escrito y, detrás, lo provisional.
export const enVivo = (base: string, parcial: string) => (parcial.trim() ? unirDictado(base, parcial) : base)

const almacen = () => (typeof localStorage === 'undefined' ? null : localStorage)

// El dictado de una caja. `alFinal` recibe cada trozo ya reconocido; `parcial` es lo que aún está oyendo.
export function usarDictado(alFinal: (t: string) => void) {
  const [escuchando, setEscuchando] = useState(false)
  const [parcial, setParcial] = useState('')
  const [error, setError] = useState<string | null>(null)
  // Se ha pulsado «Dictar» sin permiso guardado: se enseña el aviso.
  const [preguntando, setPreguntando] = useState(false)
  const rec = useRef<Reconocimiento | null>(null)
  const alFinalRef = useRef(alFinal)
  alFinalRef.current = alFinal

  useEffect(() => () => rec.current?.abort(), [])

  const empezar = useCallback(() => {
    if (!Reconocedor || rec.current) return
    const r = new Reconocedor()
    r.lang = 'es-ES'
    r.interimResults = true
    r.continuous = true
    r.onresult = (e) => {
      let prov = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const x = e.results[i]
        if (x.isFinal) alFinalRef.current(x[0].transcript)
        else prov += x[0].transcript
      }
      setParcial(prov)
    }
    r.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return
      setError(
        e.error === 'not-allowed' || e.error === 'service-not-allowed'
          ? 'No tengo permiso para usar el micrófono: dáselo en el candado de la barra de direcciones, o escribe.'
          : `El dictado falló (${e.error}). Puedes escribir la respuesta.`,
      )
    }
    r.onend = () => {
      rec.current = null
      setEscuchando(false)
      setParcial('')
    }
    rec.current = r
    setError(null)
    setEscuchando(true)
    try {
      r.start()
    } catch {
      rec.current = null
      setEscuchando(false)
    }
  }, [])

  const parar = useCallback(() => rec.current?.stop(), [])

  // «Dictar» (o D): sin permiso, primero el aviso; con él, empieza o para. El permiso se lee al pulsar (se puede
  // quitar desde los ajustes del foco).
  const alternar = useCallback(() => {
    if (rec.current) return parar()
    if (leerPermisoDictado(almacen()) !== 'si') return setPreguntando((x) => !x)
    empezar()
  }, [empezar, parar])

  const responder = useCallback(
    (si: boolean) => {
      guardarPermisoDictado(almacen(), si ? 'si' : 'no')
      setPreguntando(false)
      if (si) empezar()
    },
    [empezar],
  )

  return { disponible: !!Reconocedor, escuchando, parcial, error, preguntando, alternar, responder, parar }
}

// Quitar el permiso (desde los ajustes del foco).
export function olvidarPermisoDictado() {
  guardarPermisoDictado(almacen(), 'no')
}
