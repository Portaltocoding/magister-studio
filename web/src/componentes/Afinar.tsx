import { useEffect, useRef, useState } from 'react'
import { enviarJson, pedir } from '../api.ts'
import Mascota from '../Mascota.tsx'
import Colores from './Colores.tsx'

// La mascota de la barra de arriba: siempre a la vista; al pulsarla, «Afina a tu tutor».
// Lo que eliges se guarda en el servidor y el tutor lo tiene en cuenta desde el siguiente mensaje.

interface Preferencias {
  longitud: 'breve' | 'normal' | 'detallada'
  nivel: 'cero' | 'normal' | 'experto'
  estilo: 'directo' | 'analogias' | 'codigo'
  diagramas: boolean
  tests: boolean
  opciones: boolean
}

const GRUPOS: { campo: 'longitud' | 'nivel' | 'estilo'; titulo: string; opciones: [string, string][] }[] = [
  { campo: 'longitud', titulo: 'Respuestas', opciones: [['breve', 'Breves'], ['normal', 'Normales'], ['detallada', 'Detalladas']] },
  { campo: 'nivel', titulo: 'Tu nivel', opciones: [['cero', 'Desde cero'], ['normal', 'Normal'], ['experto', 'Avanzado']] },
  { campo: 'estilo', titulo: 'Cómo explicar', opciones: [['directo', 'Directo'], ['analogias', 'Con analogías'], ['codigo', 'Con código']] },
]

const EXTRAS: { campo: 'diagramas' | 'tests' | 'opciones'; texto: string }[] = [
  { campo: 'diagramas', texto: 'Diagramas cuando ayuden' },
  { campo: 'tests', texto: 'Un test al cerrar un concepto' },
  { campo: 'opciones', texto: 'Preguntas para seguir' },
]

export default function Afinar() {
  const [abierto, setAbierto] = useState(false)
  const [p, setP] = useState<Preferencias | null>(null)
  const [guardado, setGuardado] = useState(false)
  const caja = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (abierto && !p) pedir<Preferencias>('/api/preferencias').then(setP)
  }, [abierto, p])

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
    const nuevo = { ...p, ...cambio }
    setP(nuevo)
    await pedir('/api/preferencias', enviarJson(nuevo, 'PUT'))
    setGuardado(true)
    window.setTimeout(() => setGuardado(false), 1500)
  }

  return (
    <div className="afinar" ref={caja}>
      <button
        type="button"
        className="afinar-boton"
        aria-expanded={abierto}
        aria-label="Afina a tu tutor"
        title="Afina a tu tutor"
        onClick={() => setAbierto(!abierto)}
      >
        <Mascota mini />
      </button>
      {abierto && (
        <div className="afinar-caja" role="dialog" aria-label="Afina a tu tutor">
          <div className="afinar-cabecera">
            <strong>Afina a tu tutor</strong>
            <small className={guardado ? 'visible' : ''}>✓ Guardado</small>
          </div>
          <p className="nota">Vale desde tu siguiente mensaje, en Estudio libre y en Hablar.</p>
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
              <div className="afinar-pie">
                <Colores clase="boton-mini" />
                <button type="button" className="boton-mini" onClick={() => (window.location.hash = '#/animaciones')}>
                  Animaciones
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
