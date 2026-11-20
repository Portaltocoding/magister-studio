import { useEffect, useMemo, useRef, useState } from 'react'
import { listarPlanes, verPlan, type Conversacion } from '../api.ts'
import { MODOS, ayudaModo, nombreModo } from '../modos.ts'
import { usarPomodoro } from './pomodoro.ts'
import { filtrarPaleta } from './buscarPaleta.ts'
import { usarIdioma } from '../i18n/usarIdioma.ts'

// Ctrl+K: escribe y salta. Pantallas, lecciones, conversaciones y acciones, sin tocar el ratón.

interface Entrada {
  grupo: string
  texto: string
  detalle?: string
  hacer: () => void
}

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
  const { t, idioma } = usarIdioma()

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
      { grupo: t('paleta.grupo.acciones'), texto: t('paleta.foco'), hacer: ir('#/foco/hoy') },
      { grupo: t('paleta.grupo.acciones'), texto: t('paleta.repasar'), hacer: ir('#/repaso') },
      { grupo: t('paleta.grupo.acciones'), texto: t('paleta.nuevaConv'), detalle: t('paleta.estudioLibre'), hacer: ir('#/libre') },
      { grupo: t('paleta.grupo.acciones'), texto: t('paleta.nuevoPlan'), hacer: ir('#/nuevo-plan') },
      { grupo: t('paleta.grupo.acciones'), texto: pomo.p.fase ? t('paleta.pararPomo') : t('paleta.empezarPomo'), hacer: () => (pomo.p.fase ? pomo.parar() : pomo.empezar(25, 5)) },
      { grupo: t('paleta.grupo.acciones'), texto: t('paleta.plegar'), detalle: 'Ctrl+B', hacer: alPlegar },
      ...MODOS.filter((m) => m.encendido).map((m) => ({ grupo: t('paleta.grupo.irA'), texto: nombreModo(m.id), detalle: ayudaModo(m.id), hacer: ir(`#/${m.id}`) })),
      ...lecciones.flatMap((l) => [
        { grupo: t('paleta.grupo.lecciones'), texto: `${l.clave} · ${l.titulo}`, detalle: l.tema, hacer: ir(`#/fichas/${l.tema_id}/${l.clave}`) },
      ]),
      ...conversaciones.map((c) => ({ grupo: t('paleta.grupo.conversaciones'), texto: c.titulo, hacer: ir(`#/conversacion/${c.id}`) })),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lecciones, conversaciones, pomo.p.fase, idioma],
  )

  // El nombre que coincide gana a la descripción: «roadmap» lleva a Roadmap, no a Proyectos (buscarPaleta.ts).
  const filtradas = useMemo(() => filtrarPaleta(entradas, q), [q, entradas])

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
        aria-label={t('paleta.aria')}
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
          placeholder={t('paleta.placeholder')}
          aria-label={t('sesion.buscar')}
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
          {!filtradas.length && <li className="paleta-nada">{t('paleta.nada', { q })}</li>}
        </ul>
        <p className="paleta-pie">{t('paleta.pie')}</p>
      </div>
    </div>
  )
}
