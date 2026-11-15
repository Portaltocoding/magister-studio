import { useEffect, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { flujo, marcarSesion, pedir } from '../api.ts'
import Mascota from '../Mascota.tsx'
import type { IdModo } from '../modos.ts'

interface Hoy {
  estado: 'propuesta' | 'adelantar' | 'sin_preparar' | 'sin_plan' | 'solo_repaso'
  sesion_id?: number
  plan_id?: number
  tema?: string
  leccion_clave?: string
  titulo?: string
  horas?: number
  material_id?: number | null
  repasos: number
  razon?: string
}

interface Bloque {
  clave: string
  titulo: string
  texto: string
  pregunta: { pregunta_id: string; enunciado: string; concepto_id: string } | null
}

const CONFIANZAS: [number, string][] = [
  [0.25, 'No lo sé'],
  [0.5, 'Dudo'],
  [0.75, 'Bastante seguro'],
  [0.95, 'Seguro'],
]

// Una comprobación al final de cada bloque: respondes de memoria y el tutor corrige.
function Comprobar({ pregunta, alAcabar }: { pregunta: NonNullable<Bloque['pregunta']>; alAcabar: (nota: string) => void }) {
  const [respuesta, setRespuesta] = useState('')
  const [confianza, setConfianza] = useState<number | null>(null)
  const [nota, setNota] = useState<string | null>(null)
  const [explicacion, setExplicacion] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [inicio] = useState(() => Date.now())

  useEffect(() => {
    pedir(`/api/tutor/servir/${pregunta.pregunta_id}`, { method: 'POST' })
  }, [pregunta.pregunta_id])

  const enviar = async () => {
    setEnviando(true)
    let final = 'fallo'
    for await (const ev of flujo<{ tipo: string; nota?: string; t?: string }>('/api/practica/intentos', {
      pregunta_id: pregunta.pregunta_id,
      concepto_id: pregunta.concepto_id,
      respuesta,
      confianza,
      clave: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
      latencia_ms: Date.now() - inicio,
    })) {
      if (ev.tipo === 'nota' && ev.nota) {
        setNota(ev.nota)
        final = ev.nota
      } else if (ev.tipo === 'delta' && ev.t) setExplicacion((x) => x + ev.t)
    }
    setEnviando(false)
    alAcabar(final)
  }

  return (
    <div className="comprobar">
      <p>
        <strong>Comprueba:</strong> {pregunta.enunciado}
      </p>
      <textarea className="critica" value={respuesta} disabled={!!nota} onChange={(e) => setRespuesta(e.target.value)}
        placeholder="Con tus palabras, sin mirar arriba" aria-label="Tu respuesta" />
      {!nota && (
        <div className="fila">
          {CONFIANZAS.map(([v, t]) => (
            <button key={v} className="boton-mini" aria-pressed={confianza === v} onClick={() => setConfianza(v)}>
              {t}
            </button>
          ))}
          <button className="boton boton-principal" disabled={enviando || !respuesta.trim() || confianza == null} onClick={enviar}>
            {enviando ? 'Corrigiendo…' : 'Comprobar'}
          </button>
        </div>
      )}
      {nota && (
        <div className={`correccion nota-${nota}`}>
          <strong>Nota: {nota}</strong>
          <Markdown>{explicacion}</Markdown>
        </div>
      )}
    </div>
  )
}

// Modo Tutor: la tarjeta «Hoy» y la sesión idea a idea (docs/tutor.md).
export default function PanelTutor({ irA }: { irA: (m: IdModo) => void }) {
  const [hoy, setHoy] = useState<Hoy | null>(null)
  const [bloques, setBloques] = useState<Bloque[] | null>(null)
  const [i, setI] = useState(0)
  const [comprobado, setComprobado] = useState<Record<string, string>>({})
  const [cerrada, setCerrada] = useState(false)

  useEffect(() => {
    pedir<Hoy>('/api/hoy').then(setHoy)
  }, [])

  const empezar = async () => {
    if (!hoy?.material_id) return
    const l = await pedir<{ bloques: Bloque[] }>(`/api/tutor/leccion/${hoy.material_id}`)
    setBloques(l.bloques)
    setI(0)
  }

  if (!hoy) return <p className="vacio">Preparando…</p>

  if (!bloques)
    return (
      <div className="libre">
        <Mascota />
        {hoy.estado === 'sin_plan' && (
          <>
            <h1>Aún no tienes un plan</h1>
            <p className="nota">Cuéntame qué quieres aprender y te preparo el camino.</p>
            <button className="boton boton-principal" onClick={() => irA('roadmap')}>
              Ir a Roadmap
            </button>
          </>
        )}
        {hoy.estado === 'solo_repaso' && (
          <>
            <h1>Hoy toca repasar</h1>
            <p className="nota">{hoy.repasos} conceptos esperan.</p>
            <button className="boton boton-principal" onClick={() => irA('repaso')}>
              Repasar
            </button>
          </>
        )}
        {hoy.titulo && (
          <div className="tarjeta tarjeta-hoy">
            <span className="nota">Hoy</span>
            <strong>
              {hoy.leccion_clave} · {hoy.titulo}
            </strong>
            <span className="nota">
              {hoy.tema} · {hoy.horas} h · {hoy.razon}
            </span>
            {hoy.estado === 'sin_preparar' ? (
              <>
                <span className="nota">La lección aún no está preparada.</span>
                <button className="boton" onClick={() => irA('fichas')}>
                  Prepararla en Fichas
                </button>
              </>
            ) : (
              <button className="boton boton-principal" onClick={empezar}>
                ¿Vamos?
              </button>
            )}
            {hoy.repasos > 0 && (
              <button className="boton-mini" onClick={() => irA('repaso')}>
                Antes, {hoy.repasos} repasos
              </button>
            )}
          </div>
        )}
      </div>
    )

  const b = bloques[i]
  const ultimo = i === bloques.length - 1
  const puedeSeguir = !b.pregunta || comprobado[b.clave]

  return (
    <div className="panel sesion-tutor">
      <p className="nota">
        {hoy.leccion_clave} · {hoy.titulo} · idea {i + 1} de {bloques.length}
      </p>
      <span className="barra">
        <span style={{ width: `${((i + (puedeSeguir ? 1 : 0.5)) / bloques.length) * 100}%` }} />
      </span>
      <article className="apuntes">
        <h2 className="enunciado">{b.titulo}</h2>
        <Markdown remarkPlugins={[remarkGfm]}>{b.texto}</Markdown>
      </article>
      {b.pregunta && !comprobado[b.clave] && (
        <Comprobar key={b.clave} pregunta={b.pregunta} alAcabar={(n) => setComprobado({ ...comprobado, [b.clave]: n })} />
      )}
      {b.pregunta && comprobado[b.clave] && <p className="nota">Comprobado: {comprobado[b.clave]}</p>}
      <div className="botones">
        {i > 0 && (
          <button className="boton" onClick={() => setI(i - 1)}>
            Anterior
          </button>
        )}
        {!ultimo && (
          <button className="boton boton-principal" disabled={!puedeSeguir} onClick={() => setI(i + 1)}>
            Siguiente idea
          </button>
        )}
        {!ultimo && b.pregunta && !comprobado[b.clave] && (
          <button className="boton-mini" onClick={() => setComprobado({ ...comprobado, [b.clave]: 'saltada' })}>
            Saltar y marcar
          </button>
        )}
        {ultimo && !cerrada && (
          <button
            className="boton boton-principal"
            disabled={!puedeSeguir}
            onClick={async () => {
              if (hoy.sesion_id) await marcarSesion(hoy.sesion_id, 'hecha')
              setCerrada(true)
            }}
          >
            Cerrar la sesión
          </button>
        )}
      </div>
      {cerrada && (
        <section className="propuesta">
          <h2>Cierre</h2>
          <p>
            Sesión hecha. Lo que fallaste o marcaste vuelve en el repaso:{' '}
            {Object.entries(comprobado)
              .filter(([, n]) => n === 'fallo' || n === 'parcial' || n === 'saltada')
              .map(([k, n]) => `${k} (${n})`)
              .join(', ') || 'nada, todo bien'}
            .
          </p>
          <button className="boton" onClick={() => irA('progreso')}>
            Ver mi progreso
          </button>
        </section>
      )}
    </div>
  )
}
