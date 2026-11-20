import { useCallback, useEffect, useState } from 'react'
import { t } from '../i18n/i18n.ts'
import Vacio, { irARuta } from '../componentes/Vacio.tsx'
import Cargando, { mensajeDe, TextoError } from '../componentes/Cargando.tsx'
import { avisoIncompleta } from '../componentes/bibliotecaLeccion.ts'
import {
  pedir,
  crearFuente,
  estadoIndice,
  listarDocumentos,
  listarFuentes,
  listarPropuestas,
  listarTemas,
  reintentarVersion,
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
  // Hasta que llegan las fuentes no se pinta la lista (si no, un fallo se vería como «Sin fuentes todavía»).
  const [cargada, setCargada] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)

  const recargar = useCallback(() => {
    setFallo(null)
    Promise.all([listarFuentes(), listarTemas()])
      .then(([fs, ts]) => {
        setFuentes(fs)
        setTemas(ts)
        // #/temas/5 abre la fuente 5 (viene de «Subir el PDF» en la Biblioteca o en una lección del Roadmap).
        const deLaRuta = Number(window.location.hash.match(/^#\/temas\/(\d+)/)?.[1])
        setActiva((a) => a ?? (fs.some((f) => f.id === deLaRuta) ? deLaRuta : fs[0]?.id ?? null))
        setCargada(true)
      })
      .catch((e) => setFallo(mensajeDe(e)))
    // Lo accesorio no bloquea la pantalla: si falla, se queda como estaba.
    listarPropuestas().then(setPropuestas).catch(() => undefined)
    estadoIndice().then(setEstado).catch(() => undefined)
  }, [])

  useEffect(recargar, [recargar])

  const cargarDocs = useCallback(() => {
    if (activa != null)
      listarDocumentos(activa)
        .then(setDocs)
        .catch((e) => setAviso(`No he podido cargar los documentos: ${mensajeDe(e)}`))
  }, [activa])

  useEffect(cargarDocs, [cargarDocs])

  // Mientras haya algo en cola, se refresca cada pocos segundos.
  useEffect(() => {
    if (!docs.some((d) => d.version && ['recibida', 'pendiente'].includes(d.version.estado))) return
    const t = setInterval(() => {
      cargarDocs()
      estadoIndice().then(setEstado).catch(() => undefined)
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

  if (!cargada)
    return (
      <div className="panel">
        <h1>Tus fuentes</h1>
        <Cargando texto="Cargando tus fuentes…" error={fallo} reintentar={recargar} />
      </div>
    )

  return (
    <div className="panel">
      <h1>Tus fuentes</h1>
      <p className="nota">
        {estado ? `${estado.documentos} documentos · ${estado.fragmentos} fragmentos indexados` : ''} · El tutor responde
        con tus fuentes y cita cada afirmación.
      </p>
      {aviso && <TextoError texto={aviso} rol="status" className="nota" />}

      {propuestas.length > 0 && (
        <p className="nota">
          <button className="enlace" onClick={() => irARuta('#/buscar')}>
            {propuestas.length} {propuestas.length === 1 ? 'fuente propuesta' : 'fuentes propuestas'} por revisar, en Buscar fuentes →
          </button>
        </p>
      )}

      {fuentes.length === 0 && (
        <Vacio
          etiqueta={t('vacio.fuentes.etq')}
          titulo={t('vacio.fuentes.titulo')}
          texto={t('vacio.fuentes.texto')}
          pasos={[
            { titulo: t('vacio.fuentes.p1.t'), texto: t('vacio.fuentes.p1.x') },
            { titulo: t('vacio.fuentes.p2.t'), texto: t('vacio.fuentes.p2.x') },
            { titulo: t('vacio.fuentes.p3.t'), texto: t('vacio.fuentes.p3.x') },
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
                try {
                  await pedir(`/api/fuentes/${f.id}`, { method: 'DELETE' })
                } catch (e) {
                  setAviso(`No he podido borrar la fuente: ${mensajeDe(e)}`)
                  return
                }
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
                      {d.que_paso ? ` · ${d.que_paso}` : d.version?.motivo ? ` · ${d.version.motivo}` : ''}
                      {d.version?.duplicado_de ? ` · duplicado de ${d.version.duplicado_de}` : ''}
                      {d.version?.origen === 'research'
                        ? ` · del research${d.version.leccion_clave ? ` para ${d.version.leccion_clave}` : ''}${d.version.automatica ? ', entró solo' : ''}`
                        : ''}
                      {(d.incompleta ?? d.version?.incompleta) && (
                        <span className="aviso-incompleta" role="note">
                          {avisoIncompleta((d.incompleta ?? d.version?.incompleta)!)}{' '}
                          <label className="boton-mini">
                            Subir el PDF
                            <input
                              type="file"
                              hidden
                              accept=".pdf"
                              onChange={(e) => {
                                const f = e.target.files?.[0]
                                if (f && activa != null)
                                  conAviso(() => subirFichero(activa, f, d.tema_id), `«${f.name}» en cola. Se indexa solo.`)
                                e.target.value = ''
                              }}
                            />
                          </label>
                        </span>
                      )}
                      {/* Un servidor de antes no trae `reintentable`: entonces, como siempre, en toda cuarentena. */}
                      {(d.reintentable ?? d.version?.estado === 'cuarentena') && (
                        <>
                          {' '}
                          <button
                            className="boton-mini"
                            onClick={() =>
                              conAviso(() => reintentarVersion(d.version!.id), `«${d.titulo}» vuelve a indexarse.`)
                            }
                          >
                            Reintentar
                          </button>
                        </>
                      )}
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
