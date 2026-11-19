import { useState } from 'react'
import { enviarJson, pedir, type VistaPlan } from '../api.ts'

const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']
const HORAS = [0, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8]
const MAXIMO = 12 // el mismo tope que el servidor
// En horas y minutos: 0,75 es «45 min» y 2,75, «2 h 45 min».
const horasTexto = (h: number) => {
  if (h === 0) return 'Nada'
  const total = Math.round(h * 60)
  const [hh, mm] = [Math.floor(total / 60), total % 60]
  return hh === 0 ? `${mm} min` : mm === 0 ? `${hh} h` : `${hh} h ${mm} min`
}

interface Props {
  temaId: number
  perfil: { horas_por_dia?: number[] | null; inicio_por_dia?: (string | null)[] | null } | undefined
  alGuardar: (v: VistaPlan) => void
  alCerrar: () => void
}

// Tu horario de estudio, día a día. Al guardar se recoloca lo pendiente desde hoy; lo hecho no se toca.
export default function Horario({ temaId, perfil, alGuardar, alCerrar }: Props) {
  const [horas, setHoras] = useState<number[]>(() => perfil?.horas_por_dia?.slice(0, 7) ?? [1, 1, 1, 1, 1, 0, 0])
  const [inicio, setInicio] = useState<string[]>(() => (perfil?.inicio_por_dia ?? Array(7).fill(null)).slice(0, 7).map((x) => x ?? ''))
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const semana = horas.reduce((a, b) => a + b, 0)
  // Las de la lista y las que ya tenías (el cuestionario da cuartos de hora): si no, el desplegable enseñaría «Nada».
  const [opciones] = useState(() => [...new Set([...HORAS, ...horas])].sort((a, b) => a - b))
  const demasiadas = horas.find((h) => h > MAXIMO)

  const guardar = async () => {
    setGuardando(true)
    setError(null)
    try {
      const v = await pedir<VistaPlan>(
        `/api/temas/${temaId}/plan/horario`,
        enviarJson({ horas_por_dia: horas, inicio_por_dia: inicio.map((x, i) => (horas[i] > 0 && x ? x : null)) }, 'PUT'),
      )
      alGuardar(v)
    } catch (e) {
      setError(String((e as Error).message))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <section className="horario">
      <h2>Tu horario de estudio</h2>
      <p className="nota">Cuántas horas y desde qué hora, cada día. Al guardar se recoloca lo que queda desde hoy; lo hecho no se toca.</p>
      <div className="horario-dias">
        {DIAS.map((d, i) => (
          <div key={d} className={`horario-dia ${horas[i] ? '' : 'libre'}`}>
            <span>{d}</span>
            <select aria-label={`Horas el ${d.toLowerCase()}`} value={horas[i]} onChange={(e) => setHoras(horas.map((h, k) => (k === i ? Number(e.target.value) : h)))}>
              {opciones.map((h) => (
                <option key={h} value={h}>
                  {horasTexto(h)}
                </option>
              ))}
            </select>
            <input
              type="time"
              aria-label={`Hora de inicio el ${d.toLowerCase()}`}
              value={inicio[i]}
              disabled={!horas[i]}
              onChange={(e) => setInicio(inicio.map((x, k) => (k === i ? e.target.value : x)))}
            />
          </div>
        ))}
      </div>
      <p className="nota">
        {String(semana).replace('.', ',')} h a la semana. Para copiar un día en todos los laborables:{' '}
        <button type="button" className="boton-mini" onClick={() => { setHoras([...Array(5).fill(horas[0]), horas[5], horas[6]]); setInicio([...Array(5).fill(inicio[0]), inicio[5], inicio[6]]) }}>
          Como el lunes, de lunes a viernes
        </button>
      </p>
      {demasiadas != null && <p role="alert">{`${horasTexto(demasiadas)} pasa del máximo de ${MAXIMO} h: elige otro.`}</p>}
      {error && <p role="alert">{error}</p>}
      <div className="botones">
        <button className="boton boton-principal" disabled={guardando || semana <= 0 || demasiadas != null} onClick={guardar}>
          {guardando ? 'Recolocando…' : 'Guardar y recolocar'}
        </button>
        <button className="boton" onClick={alCerrar}>
          Cancelar
        </button>
      </div>
    </section>
  )
}
