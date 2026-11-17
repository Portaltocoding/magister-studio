import { useCallback, useEffect, useState } from 'react'
import Vacio, { irARuta } from '../componentes/Vacio.tsx'
import {
  pedir,
  crearFuente,
  estadoIndice,
  listarDocumentos,
  listarFuentes,
  listarPropuestas,
  listarTemas,
  subirFichero,
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
      <h1>Tus fuentes</h1>
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
        <p className="nota">
          <button className="enlace" onClick={() => irARuta('#/buscar')}>
            {propuestas.length} {propuestas.length === 1 ? 'fuente propuesta' : 'fuentes propuestas'} por revisar, en Buscar fuentes →
          </button>
        </p>
      )}

      {fuentes.length === 0 && (
        <Vacio
          etiqueta="Sin fuentes todavía"
          titulo="Dale al tutor tus propios materiales"
          texto="Una fuente es un sitio de donde sale lo que estudias: tus apuntes, un libro en PDF, una web. El tutor las lee, responde con ellas y cita de dónde sale cada cosa. Sin fuentes también funciona, pero con las tuyas se ciñe a tu temario."
          pasos={[
            { titulo: 'Crea una fuente', texto: 'Ponle nombre abajo: «Apuntes de clase», «Libro de BD»...' },
            { titulo: 'Sube ficheros o URLs', texto: 'PDF, Markdown, HTML o texto. Se indexan solos en segundos.' },
            { titulo: 'Pregunta', texto: 'En Estudio libre o en el tutor verás las citas a tus documentos.' },
          ]}
        />
      )}
      <div className="tarjetas tarjetas-fuentes">
        {fuentes.map((f) => (
          <div key={f.id} className="tarjeta-fuente">
            <button className="tarjeta" aria-pressed={f.id === activa} onClick={() => setActiva(f.id)}>
              <strong>{f.nombre}</strong>
              <span className="nota">
                {f.tipo} · confianza {f.confianza}
              </span>
            </button>
            <button
              className="borrar"
              aria-label={`Borrar la fuente ${f.nombre}`}
              title="Borrar la fuente y sus documentos"
              onClick={async () => {
                if (!confirm(`¿Borrar la fuente «${f.nombre}» con todos sus documentos? El tutor dejará de citarla. No se puede deshacer.`)) return
                await pedir(`/api/fuentes/${f.id}`, { method: 'DELETE' })
                if (activa === f.id) setActiva(null)
                recargar()
              }}
            >
              ×
            </button>
          </div>
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
              <option value="pdf">PDF o ficheros</option>
              <option value="libro">Libro</option>
              <option value="vault">Notas (Obsidian)</option>
              <option value="web">Web</option>
            </select>
            <select
              aria-label="Confianza"
              value={nueva.confianza}
              onChange={(e) => setNueva({ ...nueva, confianza: Number(e.target.value) })}
            >
              <option value={3}>Fiabilidad máxima (mío)</option>
              <option value={2}>Fiabilidad media (libro)</option>
              <option value={1}>Fiabilidad baja (web)</option>
            </select>
            <button className="boton-mini">Crear fuente</button>
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
            <button className="boton-mini" onClick={() => irARuta('#/web')}>
              Guardar páginas o PDF de la web →
            </button>
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
                  <th />
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
                    <td>
                      <button
                        className="borrar"
                        aria-label={`Borrar ${d.titulo}`}
                        onClick={async () => {
                          if (activa == null || !confirm(`¿Borrar «${d.titulo}»? El tutor dejará de citarlo.`)) return
                          await pedir(`/api/fuentes/${activa}/documentos/${d.id}`, { method: 'DELETE' })
                          cargarDocs()
                          recargar()
                        }}
                      >
                        ×
                      </button>
                    </td>
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
