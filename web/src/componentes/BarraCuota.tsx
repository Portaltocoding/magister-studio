// La barra de uso: cuánto llevas de tu sesión (la ventana de 5 horas de la suscripción) y de la semana, sin hablar de
// tokens. Si se le pasa una acción (un vídeo de 6 minutos, el material de una lección), marca encima, rayado, lo que se
// comería antes de aceptarla. Los datos los da el propio Claude tras cada respuesta; la estimación sale de tu uso real.
import { useEffect, useState } from 'react'
import { pedir } from '../api.ts'

interface Ventana {
  uso: number
  // null: la ventana ya se renovó y aún no se sabe cuándo vuelve a hacerlo (llega con la próxima respuesta).
  reinicia: number | null
}
interface Estado {
  sesion: Ventana | null
  semana: Ventana | null
}
interface Estimacion {
  sesion: { extra: number | null; calibrada: boolean }
  semana: { extra: number | null; calibrada: boolean }
}

export type Accion =
  | { accion: 'video'; minutos: number }
  | { accion: 'material' }
  | { accion: 'diapositivas' }
  | { accion: 'mensaje' }
  | { accion: 'proyecto' }
  | { accion: 'nivel' }
  | { accion: 'plan' }
  // Buscar fuentes para una lección: dos llamadas (las consultas y el juez que lee lo encontrado).
  | { accion: 'research' }

const pct = (x: number) => Math.round(x * 100)
const POCO = 0.05 // menos del 5 % de la sesión: una línea en vez de las barras

function cuando(epoch: number | null, semana: boolean): string {
  if (epoch == null) return ''
  const d = new Date(epoch * 1000)
  const hora = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
  const hoy = new Date().toDateString() === d.toDateString()
  if (!semana && hoy) return `a las ${hora}`
  return `el ${d.toLocaleDateString('es-ES', { weekday: 'long' })} a las ${hora}`
}

function Fila({ nombre, v, extra, semana, compacta }: { nombre: string; v: Ventana; extra: number | null; semana: boolean; compacta: boolean }) {
  const usado = Math.min(1, v.uso)
  const mas = extra ? Math.min(1 - usado, extra) : 0
  const pasa = extra != null && v.uso + extra > 1
  const renovacion = v.reinicia == null ? 'recién renovada' : `se renueva ${cuando(v.reinicia, semana)}`
  const texto = `${nombre}: ${pct(v.uso)} % usado · ${renovacion}`
  return (
    <div className={`cuota-fila ${pasa ? 'cuota-pasa' : ''}`} title={texto}>
      {!compacta && <span className="cuota-nombre">{nombre}</span>}
      <span className="cuota-barra" role="meter" aria-label={texto} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct(v.uso)}>
        <span className="cuota-usado" style={{ width: `${usado * 100}%` }} />
        {mas > 0 && <span className="cuota-extra" style={{ left: `${usado * 100}%`, width: `${Math.max(1.5, mas * 100)}%` }} />}
      </span>
      {!compacta && (
        <span className="cuota-dato">
          {pct(v.uso)} %{extra != null && <strong> +{extra < 0.005 ? '<1' : pct(extra)} %</strong>}
          <small> · {renovacion}</small>
        </span>
      )}
    </div>
  )
}

export default function BarraCuota({ accion, compacta = false }: { accion?: Accion; compacta?: boolean }) {
  const [estado, setEstado] = useState<Estado | null>(null)
  const [estimacion, setEstimacion] = useState<Estimacion | null>(null)
  const clave = accion ? JSON.stringify(accion) : ''

  useEffect(() => {
    let vigente = true
    const leer = () =>
      pedir<Estado>('/api/cuota')
        .then((e) => vigente && setEstado(e))
        .catch(() => undefined)
    leer()
    // Cada respuesta del tutor actualiza la cuota: se relee cada minuto.
    const t = setInterval(leer, 60_000)
    return () => {
      vigente = false
      clearInterval(t)
    }
  }, [])

  useEffect(() => {
    if (!accion) return setEstimacion(null)
    let vigente = true
    const q = new URLSearchParams({ accion: accion.accion, ...('minutos' in accion ? { minutos: String(accion.minutos) } : {}) })
    pedir<Estimacion>(`/api/cuota/estimar?${q}`)
      .then((e) => vigente && setEstimacion(e))
      .catch(() => vigente && setEstimacion(null))
    return () => {
      vigente = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave])

  if (!estado?.sesion && !estado?.semana) {
    if (compacta) return null
    return <p className="nota cuota-vacia">Tu uso aparecerá aquí después de la primera respuesta del tutor.</p>
  }
  const pasa = estimacion && estado.sesion && estimacion.sesion.extra != null && estado.sesion.uso + estimacion.sesion.extra > 1
  // Si gasta poco y te sobra sesión, basta una línea: las barras, para lo que de verdad pesa.
  const extra = estimacion?.sesion.extra
  if (!compacta && estado.sesion && extra != null && extra < POCO && estado.sesion.uso < 0.8)
    return (
      <p className="nota cuota-poco" title={`Semana: ${estado.semana ? pct(estado.semana.uso) : '—'} % usado`}>
        Gasta poco: {extra < 0.005 ? 'menos del 1' : `un ${pct(extra)}`} % de tu sesión (llevas un {pct(estado.sesion.uso)} %).
      </p>
    )
  return (
    <div className={`cuota ${compacta ? 'cuota-compacta' : ''}`}>
      {estado.sesion && <Fila nombre="Sesión" v={estado.sesion} extra={estimacion?.sesion.extra ?? null} semana={false} compacta={compacta} />}
      {estado.semana && <Fila nombre="Semana" v={estado.semana} extra={estimacion?.semana.extra ?? null} semana compacta={compacta} />}
      {!compacta && estimacion && (
        <p className="nota cuota-nota">
          {pasa
            ? 'No cabe en lo que queda de tu sesión: se cortaría a medias. Mejor cuando se renueve.'
            : estimacion.sesion.extra == null && estimacion.semana.extra == null
              ? 'Aún no sé cuánto gasta esto: lo sabré cuando lo hayas hecho una vez.'
              : 'Lo rayado es lo que gastaría esta generación si la aceptas.'}
          {estimacion.sesion.calibrada ? '' : ' Estimación aproximada: se afina con tu uso.'}
        </p>
      )}
    </div>
  )
}
