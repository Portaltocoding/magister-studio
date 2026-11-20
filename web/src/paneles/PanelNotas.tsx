import { useEffect, useMemo, useState } from 'react'
import { t } from '../i18n/i18n.ts'
import Markdown from '../componentes/Markdown.tsx'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { borrarNota, comentarNota, EVENTO_NOTAS, listarNotas, type Nota } from '../api.ts'
import Vacio, { irARuta } from '../componentes/Vacio.tsx'
import { TextoError } from '../componentes/Cargando.tsx'

// Mis notas: lo que guardaste de Estudio libre. Se buscan, se comentan, se borran y se descargan en Markdown.

const LARGA = 700 // a partir de aquí la nota sale recogida, con «Ver entera»

const fecha = (iso: string) => new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })

function descargar(notas: Nota[]) {
  const partes = ['# Mis notas', '']
  for (const n of notas) {
    partes.push(`## ${fecha(n.creada_en)}${n.origen ? ` · ${n.origen}` : ''}`, '', n.texto.trim(), '')
    if (n.comentario) partes.push(`> ${n.comentario.replace(/\n/g, '\n> ')}`, '')
    partes.push('---', '')
  }
  const url = URL.createObjectURL(new Blob([partes.join('\n')], { type: 'text/markdown;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'mis-notas.md'
  a.click()
  URL.revokeObjectURL(url)
}

function Tarjeta({ n, alCambiar }: { n: Nota; alCambiar: () => void }) {
  const [abierta, setAbierta] = useState(n.texto.length <= LARGA)
  const [comentario, setComentario] = useState(n.comentario ?? '')
  const [guardado, setGuardado] = useState(false)
  return (
    <article className="nota-tarjeta">
      <div className="nota-cabecera">
        <span className="nota-tipo">{n.completa ? 'Respuesta entera' : 'Trozo marcado'}</span>
        <span className="nota-meta">
          {fecha(n.creada_en)}
          {n.origen &&
            (n.conversacion_id ? (
              <>
                {' · de '}
                <a href={`#/conversacion/${n.conversacion_id}`}>«{n.origen}»</a>
              </>
            ) : (
              <> · de «{n.origen}» (conversación borrada)</>
            ))}
        </span>
        <button
          type="button"
          className="boton-mini nota-borrar"
          aria-label="Borrar esta nota"
          onClick={async () => {
            if (!confirm('¿Borrar esta nota?')) return
            await borrarNota(n.id)
            alCambiar()
          }}
        >
          Borrar
        </button>
      </div>
      <div className={`nota-texto ${abierta ? '' : 'recogida'}`}>
        <Markdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
          {n.texto}
        </Markdown>
      </div>
      {!abierta && (
        <button type="button" className="nota-ver" onClick={() => setAbierta(true)}>
          Ver entera
        </button>
      )}
      <label className="nota-comentario">
        <span>Tu comentario {guardado && <small>guardado</small>}</span>
        <textarea
          rows={2}
          placeholder="Por qué te importa, qué repasar, una duda…"
          value={comentario}
          onChange={(e) => {
            setComentario(e.target.value)
            setGuardado(false)
          }}
          onBlur={async () => {
            if ((n.comentario ?? '') === comentario.trim()) return
            await comentarNota(n.id, comentario.trim() || null)
            setGuardado(true)
          }}
        />
      </label>
    </article>
  )
}

export default function PanelNotas() {
  const [notas, setNotas] = useState<Nota[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busca, setBusca] = useState('')

  const cargar = () =>
    listarNotas()
      .then((ns) => {
        setNotas(ns)
        setError(null)
      })
      .catch((e) => setError(String((e as Error).message)))
  useEffect(() => {
    cargar()
    window.addEventListener(EVENTO_NOTAS, cargar)
    return () => window.removeEventListener(EVENTO_NOTAS, cargar)
  }, [])

  const vistas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!notas || !q) return notas ?? []
    return notas.filter((n) => `${n.texto} ${n.comentario ?? ''} ${n.origen ?? ''}`.toLowerCase().includes(q))
  }, [notas, busca])

  if (error) return <div className="panel"><TextoError texto={error} antes="No se pudieron cargar tus notas. " /></div>
  if (!notas) return <div className="panel" />
  if (!notas.length)
    return (
      <div className="panel">
        <Vacio
          etiqueta={t('vacio.notas.etq')}
          titulo={t('vacio.notas.titulo')}
          texto={t('vacio.notas.texto')}
          pasos={[
            { titulo: t('vacio.notas.p1.t'), texto: t('vacio.notas.p1.x') },
            { titulo: t('vacio.notas.p2.t'), texto: t('vacio.notas.p2.x') },
            { titulo: t('vacio.notas.p3.t'), texto: t('vacio.notas.p3.x') },
          ]}
          acciones={[{ texto: t('vacio.notas.ir'), principal: true, alPulsar: () => irARuta('#/libre') }]}
        />
      </div>
    )
  return (
    <div className="panel notas">
      <h1>Mis notas</h1>
      <p className="nota">Lo que guardaste de Estudio libre. Búscalo, coméntalo y llévatelo en Markdown.</p>
      <div className="notas-barra">
        <input type="search" placeholder="Buscar en tus notas" aria-label="Buscar en tus notas" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <button type="button" className="boton" onClick={() => descargar(vistas)}>
          Descargar {vistas.length === notas.length ? 'todas' : `estas ${vistas.length}`} (.md)
        </button>
      </div>
      {!vistas.length && <p className="nota">Ninguna nota tiene «{busca}».</p>}
      <div className="notas-lista">
        {vistas.map((n) => (
          <Tarjeta key={n.id} n={n} alCambiar={cargar} />
        ))}
      </div>
    </div>
  )
}
