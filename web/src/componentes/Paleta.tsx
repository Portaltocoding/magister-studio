import { useEffect, useMemo, useRef, useState } from 'react'
import { listarPlanes, verPlan, type Conversacion } from '../api.ts'
import { MODOS } from '../modos.ts'
import { usarPomodoro } from './pomodoro.ts'

// Ctrl+K: escribe y salta. Pantallas, lecciones, conversaciones y acciones, sin tocar el ratón.

interface Entrada {
  grupo: string
  texto: string
  detalle?: string
  hacer: () => void
}

const plano = (t: string) =>
  t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')

let cacheLecciones: { clave: string; titulo: string; tema_id: number; tema: string }[] | null = null

export default function Paleta({ conversaciones, alPlegar }: { conversaciones: Conversacion[]; alPlegar: () => void }) {
  const [abierta, setAbierta] = useState(false)
  const [q, setQ] = useState('')
  const [i, setI] = useState(0)
  const [lecciones, setLecciones] = useState<{ clave: string; titulo: string; tema_id: number; tema: string }[]>([])
  const caja = useRef<HTMLInputElement | null>(null)
  // Dónde estaba el foco al abrir: al cerrar vuelve ahí.
  const antes = useRef<HTMLElement | null>(null)
  const pomo = usarPomodoro()

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setAbierta((x) => !x)
      }
    }
    const abrir = () => setAbierta(true)
    window.addEventListener('keydown', tecla)
    window.addEventListener('magister-paleta', abrir)
    return () => {
      window.removeEventListener('keydown', tecla)
      window.removeEventListener('magister-paleta', abrir)
    }
  }, [])

  useEffect(() => {
    if (!abierta) {
      antes.current?.focus?.()
      return
    }
    antes.current = document.activeElement as HTMLElement | null
    setQ('')
    setI(0)
    window.setTimeout(() => caja.current?.focus(), 30)
    // Las lecciones se cargan una vez (y todas a la vez), no en cada apertura.
    if (cacheLecciones) {
      setLecciones(cacheLecciones)
      return
    }
    // Si falla, la paleta funciona igual sin las lecciones y lo reintenta la próxima vez que se abra (no se guarda en caché).
    listarPlanes()
      .then(async (ps) => {
        const vistas = await Promise.all(ps.map((p) => verPlan(p.tema_id)))
        const todas = vistas.flatMap((v, k) => v.lecciones.map((l) => ({ clave: l.clave, titulo: l.titulo, tema_id: ps[k].tema_id, tema: ps[k].tema })))
        cacheLecciones = todas
        setLecciones(todas)
      })
      .catch(() => undefined)
  }, [abierta])

  const ir = (ruta: string) => () => {
    window.location.hash = ruta
  }

  const entradas = useMemo<Entrada[]>(
    () => [
      { grupo: 'Acciones', texto: 'Empezar la lección de hoy en modo foco', hacer: ir('#/foco/hoy') },
      { grupo: 'Acciones', texto: 'Repasar lo de hoy', hacer: ir('#/repaso') },
      { grupo: 'Acciones', texto: 'Nueva conversación', detalle: 'Estudio libre', hacer: ir('#/libre') },
      { grupo: 'Acciones', texto: 'Nuevo plan', hacer: ir('#/nuevo-plan') },
      { grupo: 'Acciones', texto: pomo.p.fase ? 'Parar el pomodoro' : 'Empezar un pomodoro de 25 + 5', hacer: () => (pomo.p.fase ? pomo.parar() : pomo.empezar(25, 5)) },
      { grupo: 'Acciones', texto: 'Abrir o plegar la barra lateral', detalle: 'Ctrl+B', hacer: alPlegar },
      ...MODOS.filter((m) => m.encendido).map((m) => ({ grupo: 'Ir a', texto: m.nombre, detalle: m.ayuda, hacer: ir(`#/${m.id}`) })),
      ...lecciones.flatMap((l) => [
        { grupo: 'Lecciones', texto: `${l.clave} · ${l.titulo}`, detalle: l.tema, hacer: ir(`#/fichas/${l.tema_id}/${l.clave}`) },
      ]),
      ...conversaciones.map((c) => ({ grupo: 'Conversaciones', texto: c.titulo, hacer: ir(`#/conversacion/${c.id}`) })),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lecciones, conversaciones, pomo.p.fase],
  )

  const filtradas = useMemo(() => {
    const palabras = plano(q).split(/\s+/).filter(Boolean)
    if (!palabras.length) return entradas.filter((e) => e.grupo !== 'Conversaciones').slice(0, 14)
    return entradas.filter((e) => palabras.every((w) => plano(`${e.texto} ${e.detalle ?? ''} ${e.grupo}`).includes(w))).slice(0, 14)
  }, [q, entradas])

  if (!abierta) return null

  const elegir = (e: Entrada | undefined) => {
    if (!e) return
    setAbierta(false)
    e.hacer()
  }

  return (
    <div className="paleta-velo" onMouseDown={() => setAbierta(false)}>
      <div
        className="paleta"
        role="dialog"
        aria-modal="true"
        aria-label="Ir a o hacer"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // Esc cierra desde cualquier sitio de la paleta; Tab no se escapa a lo de detrás.
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            setAbierta(false)
          } else if (e.key === 'Tab') {
            e.preventDefault()
            caja.current?.focus()
          }
        }}
      >
        <input
          ref={caja}
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setI(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setI((x) => Math.min(filtradas.length - 1, x + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setI((x) => Math.max(0, x - 1))
            } else if (e.key === 'Enter') elegir(filtradas[i])
          }}
          placeholder="Ir a una pantalla, una lección, una conversación… o hacer algo"
          aria-label="Buscar"
        />
        <ul>
          {filtradas.map((e, k) => (
            <li key={`${e.grupo}-${e.texto}`}>
              <button type="button" className={k === i ? 'actual' : ''} onMouseEnter={() => setI(k)} onClick={() => elegir(e)}>
                <small>{e.grupo}</small>
                <span>{e.texto}</span>
                {e.detalle && <em>{e.detalle}</em>}
              </button>
            </li>
          ))}
          {!filtradas.length && <li className="paleta-nada">Nada con «{q}».</li>}
        </ul>
        <p className="paleta-pie">↑ ↓ para elegir · Intro para ir · Esc para cerrar</p>
      </div>
    </div>
  )
}
