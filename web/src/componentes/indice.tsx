import { useEffect, useState } from 'react'
import { enviarJson, pedir } from '../api.ts'

// El índice sencillo del plan: temas con nombre llano y un título corto por lección.
// Se pide una vez por plan y se comparte entre pantallas.

export interface IndicePlan {
  temas: { nombre: string; lecciones: string[]; trata: string[] }[]
  titulos: Record<string, string>
}

const cache = new Map<number, IndicePlan | null>()

export function usarIndice(planId: number | null | undefined): IndicePlan | null {
  const [ix, setIx] = useState<IndicePlan | null>(planId != null ? (cache.get(planId) ?? null) : null)
  useEffect(() => {
    if (planId == null) return
    if (cache.has(planId)) {
      setIx(cache.get(planId) ?? null)
      return
    }
    pedir<IndicePlan | null>(`/api/planes/${planId}/indice`)
      .then((r) => {
        cache.set(planId, r)
        setIx(r)
      })
      .catch(() => undefined)
  }, [planId])
  // Un cambio en una pantalla (un título que editas) se ve en todas.
  useEffect(() => {
    const al = (e: Event) => {
      const d = (e as CustomEvent<{ planId: number; ix: IndicePlan }>).detail
      if (d.planId === planId) setIx(d.ix)
    }
    window.addEventListener('magister-indice', al)
    return () => window.removeEventListener('magister-indice', al)
  }, [planId])
  return ix
}

export function guardarIndice(planId: number, ix: IndicePlan) {
  cache.set(planId, ix)
  window.dispatchEvent(new CustomEvent('magister-indice', { detail: { planId, ix } }))
}

// El título de una lección, con un lápiz para cambiarlo a tu gusto o volver al original.
export function TituloEditable({ planId, clave, largo, indice }: { planId: number; clave: string; largo: string; indice: IndicePlan | null }) {
  const [editando, setEditando] = useState(false)
  const actual = tituloSencillo(indice, clave, largo)
  const guardar = async (titulo: string | null) => {
    const ix = await pedir<IndicePlan>(`/api/planes/${planId}/indice/titulo`, enviarJson({ clave, titulo }, 'PUT'))
    guardarIndice(planId, ix)
    setEditando(false)
  }
  if (editando)
    return (
      <form
        className="titulo-editar"
        onSubmit={(e) => {
          e.preventDefault()
          guardar(new FormData(e.currentTarget).get('t')?.toString() ?? null)
        }}
      >
        <input name="t" defaultValue={actual} autoFocus aria-label="Título de la lección" onKeyDown={(e) => e.key === 'Escape' && setEditando(false)} />
        <button className="boton-mini">Guardar</button>
        {indice?.titulos[clave] && (
          <button type="button" className="boton-mini" onClick={() => guardar(null)} title={largo}>
            El original
          </button>
        )}
      </form>
    )
  return (
    <span className="titulo-editable">
      {actual}
      {indice && (
        <button type="button" className="titulo-lapiz" onClick={() => setEditando(true)} aria-label="Cambiar el título" title="Cambiar el título">
          ✎
        </button>
      )}
    </span>
  )
}

// El título que se enseña: el sencillo si lo hay; el largo queda como detalle.
export const tituloSencillo = (ix: IndicePlan | null, clave: string, largo: string) => ix?.titulos[clave] ?? largo

// En qué tema está una lección.
export const temaDe = (ix: IndicePlan | null, clave: string) => ix?.temas.find((t) => t.lecciones.includes(clave))?.nombre ?? null

interface EstadoLibro {
  estado: 'haciendo' | 'listo' | 'error'
  lecciones?: string[]
  faltan?: string[]
  paginas?: number
  error?: string | null
}

// El libro del tema: todos los apuntes preparados en un PDF, ordenados por temas.
export function BotonLibro({ planId }: { planId: number }) {
  const [e, setE] = useState<EstadoLibro | null>(null)
  useEffect(() => {
    let vivo = true
    const mirar = () =>
      pedir<EstadoLibro | null>(`/api/planes/${planId}/libro`)
        .then((r) => vivo && setE(r))
        .catch(() => undefined)
    mirar()
    const t = window.setInterval(() => e?.estado === 'haciendo' && mirar(), 4000)
    return () => {
      vivo = false
      window.clearInterval(t)
    }
  }, [planId, e?.estado])
  const montar = async () => {
    await pedir(`/api/planes/${planId}/libro`, { method: 'POST' })
    setE({ estado: 'haciendo' })
  }
  return (
    <div className="libro-tema">
      {e?.estado === 'haciendo' ? (
        <span className="nota">Montando el libro con todos tus apuntes… (un par de minutos)</span>
      ) : (
        <>
          {e?.estado === 'listo' && (
            <a className="boton boton-principal" href={`/api/planes/${planId}/libro/pdf`} target="_blank" rel="noreferrer">
              Abrir el libro del tema
            </a>
          )}
          <button className="boton" onClick={montar} title="Junta los apuntes de todas las lecciones preparadas en un solo PDF">
            {e?.estado === 'listo' ? 'Volver a montarlo' : 'Montar el libro del tema'}
          </button>
          {e?.estado === 'listo' && (
            <span className="nota">
              {e.lecciones?.length} lecciones{e.paginas ? `, ${e.paginas} páginas` : ''}
              {e.faltan?.length ? ` · faltan por preparar: ${e.faltan.join(', ')}` : ''}
            </span>
          )}
          {e?.estado === 'error' && <span className="nota">No se pudo montar: {e.error}</span>}
        </>
      )}
    </div>
  )
}
