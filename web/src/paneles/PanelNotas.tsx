import { useEffect, useMemo, useState } from 'react'
import { t } from '../i18n/i18n.ts'
import Markdown from '../componentes/Markdown.tsx'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { borrarNota, comentarNota, EVENTO_NOTAS, listarNotas, type Nota } from '../api.ts'
import Vacio, { irARuta } from '../componentes/Vacio.tsx'
import { TextoError } from '../componentes/Cargando.tsx'
import { usarIdioma } from '../i18n/usarIdioma.ts'
import { localeActual } from '../componentes/formato.ts'

// Mis notas: lo que guardaste de Estudio libre. Se buscan, se comentan, se borran y se descargan en Markdown.

const LARGA = 700 // a partir de aquí la nota sale recogida, con «Ver entera»

const fecha = (iso: string) => new Date(iso).toLocaleDateString(localeActual(), { day: 'numeric', month: 'short', year: 'numeric' })

function descargar(notas: Nota[]) {
  const partes = [`# ${t('notas.titulo')}`, '']
  for (const n of notas) {
    partes.push(`## ${fecha(n.creada_en)}${n.origen ? ` · ${n.origen}` : ''}`, '', n.texto.trim(), '')
    if (n.comentario) partes.push(`> ${n.comentario.replace(/\n/g, '\n> ')}`, '')
    partes.push('---', '')
  }
  const url = URL.createObjectURL(new Blob([partes.join('\n')], { type: 'text/markdown;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = t('notas.archivo')
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
        <span className="nota-tipo">{n.completa ? t('notas.entera') : t('notas.trozo')}</span>
        <span className="nota-meta">
          {fecha(n.creada_en)}
          {n.origen &&
            (n.conversacion_id ? (
              <>
                {t('notas.de')}
                <a href={`#/conversacion/${n.conversacion_id}`}>«{n.origen}»</a>
              </>
            ) : (
              <>{t('notas.deBorrada', { origen: n.origen })}</>
            ))}
        </span>
        <button
          type="button"
          className="boton-mini nota-borrar"
          aria-label={t('notas.borrarAria')}
          onClick={async () => {
            if (!confirm(t('notas.confirmar'))) return
            await borrarNota(n.id)
            alCambiar()
          }}
        >
          {t('notas.borrar')}
        </button>
      </div>
      <div className={`nota-texto ${abierta ? '' : 'recogida'}`}>
        <Markdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
          {n.texto}
        </Markdown>
      </div>
      {!abierta && (
        <button type="button" className="nota-ver" onClick={() => setAbierta(true)}>
          {t('notas.verEntera')}
        </button>
      )}
      <label className="nota-comentario">
        <span>{t('notas.comentario')} {guardado && <small>{t('notas.guardado')}</small>}</span>
        <textarea
          rows={2}
          placeholder={t('notas.comentarioPh')}
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
  usarIdioma() // los textos siguen al idioma
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

  if (error) return <div className="panel"><TextoError texto={error} antes={t('notas.noCarga')} /></div>
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
      <h1>{t('notas.titulo')}</h1>
      <p className="nota">{t('notas.intro')}</p>
      <div className="notas-barra">
        <input type="search" placeholder={t('notas.buscar')} aria-label={t('notas.buscar')} value={busca} onChange={(e) => setBusca(e.target.value)} />
        <button type="button" className="boton" onClick={() => descargar(vistas)}>
          {vistas.length === notas.length ? t('notas.descargarTodas') : t('notas.descargarEstas', { n: vistas.length })}
        </button>
      </div>
      {!vistas.length && <p className="nota">{t('notas.ninguna', { busca })}</p>}
      <div className="notas-lista">
        {vistas.map((n) => (
          <Tarjeta key={n.id} n={n} alCambiar={cargar} />
        ))}
      </div>
    </div>
  )
}
