import { useEffect, useRef, useState } from 'react'
import { cambiarPreferencias, todosLosModos, usarPreferencias, type PreferenciasTutor } from './preferencias.ts'
import Mascota from '../Mascota.tsx'
import { asesorActivo, EVENTO_COGER, EVENTO_ESTADO } from './Asesor.tsx'

// La mascota de la barra de arriba: siempre a la vista; al pulsarla, los ajustes rápidos del tutor (cómo te explica).
// Todo lo demás (lo que recuerda de ti, aspecto, voz, avisos) está en la sección Ajustes.
// Lo que eliges se guarda en el servidor y el tutor lo tiene en cuenta desde el siguiente mensaje.

type Preferencias = PreferenciasTutor

export const GRUPOS: { campo: 'longitud' | 'nivel' | 'estilo'; titulo: string; opciones: [string, string][] }[] = [
  { campo: 'longitud', titulo: 'Respuestas', opciones: [['breve', 'Breves'], ['normal', 'Normales'], ['detallada', 'Detalladas']] },
  { campo: 'nivel', titulo: 'Tu nivel', opciones: [['cero', 'Desde cero'], ['normal', 'Normal'], ['experto', 'Avanzado']] },
  { campo: 'estilo', titulo: 'Cómo explicar', opciones: [['directo', 'Directo'], ['analogias', 'Con analogías'], ['codigo', 'Con código']] },
]

export const EXTRAS: { campo: 'diagramas' | 'tests' | 'opciones'; texto: string }[] = [
  { campo: 'diagramas', texto: 'Diagramas' },
  { campo: 'tests', texto: 'Test al cerrar un tema' },
  { campo: 'opciones', texto: 'Sugerencias para seguir' },
]

export const avisosActivos = () => {
  try {
    return localStorage.getItem('magister-avisos') !== 'no'
  } catch {
    return true
  }
}

export default function Afinar() {
  const [abierto, setAbierto] = useState(false)
  const p = usarPreferencias()
  const [guardado, setGuardado] = useState(false)
  const caja = useRef<HTMLDivElement | null>(null)
  // Si la mascota está fuera como asesor, en la barra queda su hueco.
  const [fuera, setFuera] = useState(asesorActivo)
  const ultimo = useRef({ x: 0, y: 0 })
  useEffect(() => {
    const al = (e: Event) => setFuera((e as CustomEvent<boolean>).detail)
    window.addEventListener(EVENTO_ESTADO, al)
    return () => window.removeEventListener(EVENTO_ESTADO, al)
  }, [])

  useEffect(() => {
    if (!abierto) return
    const fuera = (e: MouseEvent) => {
      if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setAbierto(false)
    document.addEventListener('mousedown', fuera)
    window.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', fuera)
      window.removeEventListener('keydown', esc)
    }
  }, [abierto])

  const cambiar = async (cambio: Partial<Preferencias>) => {
    if (!p) return
    await cambiarPreferencias(cambio)
    setGuardado(true)
    window.setTimeout(() => setGuardado(false), 1500)
  }

  return (
    <div className="afinar" ref={caja}>
      <button
        type="button"
        className={`afinar-boton ${fuera ? 'fuera' : ''}`}
        aria-expanded={abierto}
        aria-label="Afina a tu tutor"
        title="Afina a tu tutor · mantén pulsada la mascota para sacarla como asesor"
        onClick={() => setAbierto(!abierto)}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          // Mantenerla pulsada la saca de la barra: se convierte en tu asesor y te sigue hasta que la sueltas.
          ultimo.current = { x: e.clientX, y: e.clientY }
          const t = window.setTimeout(() => {
            setAbierto(false)
            window.dispatchEvent(new CustomEvent(EVENTO_COGER, { detail: ultimo.current }))
          }, 350)
          const cancelar = () => {
            window.clearTimeout(t)
            window.removeEventListener('pointerup', cancelar)
            window.removeEventListener('pointermove', seguir)
          }
          const seguir = (ev: PointerEvent) => (ultimo.current = { x: ev.clientX, y: ev.clientY })
          window.addEventListener('pointerup', cancelar)
          window.addEventListener('pointermove', seguir)
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <Mascota mini quieta />
      </button>
      {abierto && (
        <div className="afinar-caja" role="dialog" aria-label="Afina a tu tutor">
          <div className="afinar-cabecera">
            <strong>Afina a tu tutor</strong>
            <small className={guardado ? 'visible' : ''}>✓ Guardado</small>
          </div>
          <p className="nota">Se aplica desde tu próximo mensaje.</p>
          {!p ? (
            <p className="nota">Cargando…</p>
          ) : (
            <>
              {GRUPOS.map((g) => (
                <div key={g.campo} className="afinar-grupo">
                  <span>{g.titulo}</span>
                  <div className="afinar-segmentos" role="radiogroup" aria-label={g.titulo}>
                    {g.opciones.map(([valor, texto]) => (
                      <button
                        key={valor}
                        type="button"
                        role="radio"
                        aria-checked={p[g.campo] === valor}
                        onClick={() => cambiar({ [g.campo]: valor } as Partial<Preferencias>)}
                      >
                        {texto}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <div className="afinar-extras">
                {EXTRAS.map((x) => (
                  <label key={x.campo}>
                    <input type="checkbox" checked={p[x.campo]} onChange={(e) => cambiar({ [x.campo]: e.target.checked } as Partial<Preferencias>)} />
                    {x.texto}
                  </label>
                ))}
              </div>
              <div className="afinar-grupo">
                <span>Modo</span>
                <select value={p.modo ?? ''} onChange={(e) => cambiar({ modo: e.target.value || null })} aria-label="Modo de aprendizaje">
                  <option value="">Normal</option>
                  {todosLosModos(p).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nombre}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
          <div className="afinar-pie">
            <button
              type="button"
              className="boton-mini"
              onClick={() => {
                setAbierto(false)
                window.location.hash = '#/ajustes'
              }}
            >
              Todos los ajustes →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
