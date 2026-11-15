import { useCallback, useEffect, useState } from 'react'
import {
  crearFuente,
  decidirPropuesta,
  estadoIndice,
  listarDocumentos,
  listarFuentes,
  listarPropuestas,
  listarTemas,
  subirFichero,
  subirUrl,
  type DocumentoInfo,
  type Fuente,
  type PropuestaInfo,
  type Tema,
} from '../api.ts'

const ESTADOS: Record<string, string> = {
  recibida: 'recibida, en cola',
  pendiente: 'texto listo, indexando',
  lista: 'lista',
  cuarentena: 'en cuarentena',
  retirada: 'retirada',
}

// Temas y fuentes: tus fuentes, sus documentos con estado, la subida y las propuestas del research.
export default function PanelFuentes() {
  const [fuentes, setFuentes] = useState<Fuente[]>([])
  const [temas, setTemas] = useState<Tema[]>([])
  const [activa, setActiva] = useState<number | null>(null)
  const [docs, setDocs] = useState<DocumentoInfo[]>([])
  const [propuestas, setPropuestas] = useState<PropuestaInfo[]>([])
  const [estado, setEstado] = useState<{ documentos: number; fragmentos: number } | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [nueva, setNueva] = useState({ nombre: '', tipo: 'pdf' as Fuente['tipo'], confianza: 3 })
  const [url, setUrl] = useState('')
  const [tema, setTema] = useState<number | null>(null)

  const recargar = useCallback(() => {
    listarFuentes().then((fs) => {
      setFuentes(fs)
      setActiva((a) => a ?? fs[0]?.id ?? null)
    })
    listarTemas().then(setTemas)
    listarPropuestas().then(setPropuestas)
    estadoIndice().then(setEstado)
  }, [])

  useEffect(recargar, [recargar])

  const cargarDocs = useCallback(() => {
    if (activa != null) listarDocumentos(activa).then(setDocs)
  }, [activa])

  useEffect(cargarDocs, [cargarDocs])

  // Mientras haya algo en cola, se refresca cada pocos segundos.
  useEffect(() => {
    if (!docs.some((d) => d.version && ['recibida', 'pendiente'].includes(d.version.estado))) return
    const t = setInterval(() => {
      cargarDocs()
      estadoIndice().then(setEstado)
    }, 3000)
    return () => clearInterval(t)
  }, [docs, cargarDocs])

  const conAviso = async (accion: () => Promise<unknown>, texto: string) => {
    try {
      await accion()
      setAviso(texto)
      cargarDocs()
      recargar()
    } catch (e) {
      setAviso(String((e as Error).message))
    }
  }

  return (
    <div className="panel">
      <h1>Temas y fuentes</h1>
      <p className="nota">
        {estado ? `${estado.documentos} documentos · ${estado.fragmentos} fragmentos indexados` : ''} · El tutor responde
        con tus fuentes y cita cada afirmación.
      </p>
      {aviso && (
        <p className="nota" role="status">
          {aviso}
        </p>
      )}

      {propuestas.length > 0 && (
        <section className="propuesta">
          <h2>Propuestas del research ({propuestas.length})</h2>
          <ul className="lista-propuestas">
            {propuestas.map((p) => (
              <li key={p.id}>
                <a href={p.url} target="_blank" rel="noreferrer">
                  {p.titulo || p.url}
                </a>{' '}
                <span className="nota-linea">
                  {p.leccion_clave} · {p.motivo}
                </span>{' '}
                <button
                  className="boton-mini"
                  onClick={() => conAviso(() => decidirPropuesta(p.id, 'aprobar'), 'Aprobada: entra por la ingesta.')}
                >
                  Aprobar
                </button>{' '}
                <button
                  className="boton-mini"
                  onClick={() => conAviso(() => decidirPropuesta(p.id, 'rechazar'), 'Rechazada.')}
                >
                  Rechazar
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="tarjetas">
        {fuentes.map((f) => (
          <button key={f.id} className="tarjeta" aria-pressed={f.id === activa} onClick={() => setActiva(f.id)}>
            <strong>{f.nombre}</strong>
            <span className="nota">
              {f.tipo} · confianza {f.confianza}
            </span>
          </button>
        ))}
        <form
          className="tarjeta"
          onSubmit={(e) => {
            e.preventDefault()
            if (!nueva.nombre.trim()) return
            conAviso(() => crearFuente(nueva.nombre.trim(), nueva.tipo, nueva.confianza), 'Fuente creada.')
          }}
        >
          <input
            placeholder="Nueva fuente (apuntes, libro BD...)"
            aria-label="Nombre de la fuente nueva"
            value={nueva.nombre}
            onChange={(e) => setNueva({ ...nueva, nombre: e.target.value })}
          />
          <span className="fila">
            <select
              aria-label="Tipo"
              value={nueva.tipo}
              onChange={(e) => setNueva({ ...nueva, tipo: e.target.value as Fuente['tipo'] })}
            >
              <option value="pdf">pdf</option>
              <option value="libro">libro</option>
              <option value="vault">vault</option>
              <option value="web">web</option>
            </select>
            <select
              aria-label="Confianza"
              value={nueva.confianza}
              onChange={(e) => setNueva({ ...nueva, confianza: Number(e.target.value) })}
            >
              <option value={3}>3 · tuyo</option>
              <option value={2}>2 · libro</option>
              <option value={1}>1 · web</option>
            </select>
            <button className="boton-mini">Crear</button>
          </span>
        </form>
      </div>

      {activa != null && (
        <section>
          <h2>Añadir a esta fuente</h2>
          <div className="fila">
            <label>
              Tema{' '}
              <select value={tema ?? ''} onChange={(e) => setTema(e.target.value ? Number(e.target.value) : null)}>
                <option value="">sin tema (vale para todos)</option>
                {temas.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nombre}
                  </option>
                ))}
              </select>
            </label>
            <label className="boton-mini">
              Subir fichero (PDF, Markdown, HTML, texto)
              <input
                type="file"
                hidden
                multiple
                accept=".pdf,.md,.markdown,.txt,.html,.htm"
                onChange={(e) => {
                  const ficheros = Array.from(e.target.files ?? [])
                  conAviso(
                    () => Promise.all(ficheros.map((f) => subirFichero(activa, f, tema))),
                    `${ficheros.length} fichero(s) en cola. Se indexan solos.`,
                  )
                  e.target.value = ''
                }}
              />
            </label>
            <form
              className="fila"
              onSubmit={(e) => {
                e.preventDefault()
                if (!url.trim()) return
                conAviso(() => subirUrl(activa, url.trim(), tema), 'Página en cola.')
                setUrl('')
              }}
            >
              <input placeholder="https://..." aria-label="URL" value={url} onChange={(e) => setUrl(e.target.value)} />
              <button className="boton-mini">Añadir URL</button>
            </form>
          </div>
          <p className="nota">
            Para una carpeta entera o tu vault de Obsidian: <code>uv run magister ingerir RUTA --fuente NOMBRE</code>
          </p>
          <h2>Documentos</h2>
          {docs.length === 0 ? (
            <p className="vacio">Esta fuente aún no tiene documentos.</p>
          ) : (
            <table className="tabla">
              <thead>
                <tr>
                  <th>Documento</th>
                  <th>Estado</th>
                  <th>Fragmentos</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id}>
                    <td title={d.uri}>{d.titulo}</td>
                    <td className={`estado-${d.version?.estado}`}>
                      {d.version ? ESTADOS[d.version.estado] : '·'}
                      {d.version?.motivo ? ` · ${d.version.motivo}` : ''}
                      {d.version?.duplicado_de ? ` · duplicado de ${d.version.duplicado_de}` : ''}
                    </td>
                    <td>{d.fragmentos}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  )
}
