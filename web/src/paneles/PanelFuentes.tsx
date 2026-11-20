import { useCallback, useEffect, useState } from 'react'
import { t } from '../i18n/i18n.ts'
import { usarIdioma } from '../i18n/usarIdioma.ts'
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

const textoEstado = (e: string): string => (['recibida', 'pendiente', 'lista', 'cuarentena', 'retirada'].includes(e) ? t(`fuen.estado.${e}` as 'fuen.estado.lista') : e)

// Temas y fuentes: tus fuentes, sus documentos con estado, la subida y las propuestas del research.
export default function PanelFuentes() {
  usarIdioma() // los textos siguen al idioma
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
        .catch((e) => setAviso(t('fuen.noDocs', { motivo: mensajeDe(e) })))
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
        <h1>{t('fuen.titulo')}</h1>
        <Cargando texto={t('fuen.cargando')} error={fallo} reintentar={recargar} />
      </div>
    )

  return (
    <div className="panel">
      <h1>{t('fuen.titulo')}</h1>
      <p className="nota">
        {estado ? t('fuen.indexados', { docs: estado.documentos, frag: estado.fragmentos }) : ''}{t('fuen.nota')}
      </p>
      {aviso && <TextoError texto={aviso} rol="status" className="nota" />}

      {propuestas.length > 0 && (
        <p className="nota">
          <button className="enlace" onClick={() => irARuta('#/buscar')}>
            {t('fuen.porRevisar', { n: propuestas.length, fuentes: propuestas.length === 1 ? t('fuen.propuesta') : t('fuen.propuestas') })}
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
                {t('fuen.confianza', { tipo: f.tipo, n: f.confianza })}
              </span>
            </button>
            <button
              className="borrar"
              aria-label={t('fuen.borrarAria', { nombre: f.nombre })}
              title={t('fuen.borrarTitulo')}
              onClick={async () => {
                if (!confirm(t('fuen.confirmarBorrar', { nombre: f.nombre }))) return
                try {
                  await pedir(`/api/fuentes/${f.id}`, { method: 'DELETE' })
                } catch (e) {
                  setAviso(t('fuen.noBorrar', { motivo: mensajeDe(e) }))
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
            conAviso(() => crearFuente(nueva.nombre.trim(), nueva.tipo, nueva.confianza), t('fuen.creada'))
          }}
        >
          <input
            placeholder={t('fuen.nuevaPlaceholder')}
            aria-label={t('fuen.nuevaAria')}
            value={nueva.nombre}
            onChange={(e) => setNueva({ ...nueva, nombre: e.target.value })}
          />
          <span className="fila">
            <select
              aria-label={t('fuen.tipo')}
              value={nueva.tipo}
              onChange={(e) => setNueva({ ...nueva, tipo: e.target.value as Fuente['tipo'] })}
            >
              <option value="pdf">{t('fuen.tipo.pdf')}</option>
              <option value="libro">{t('fuen.tipo.libro')}</option>
              <option value="vault">{t('fuen.tipo.vault')}</option>
              <option value="web">{t('fuen.tipo.web')}</option>
            </select>
            <select
              aria-label={t('fuen.confianzaAria')}
              value={nueva.confianza}
              onChange={(e) => setNueva({ ...nueva, confianza: Number(e.target.value) })}
            >
              <option value={3}>{t('fuen.conf3')}</option>
              <option value={2}>{t('fuen.conf2')}</option>
              <option value={1}>{t('fuen.conf1')}</option>
            </select>
            <button className="boton-mini">{t('fuen.crear')}</button>
          </span>
        </form>
      </div>

      {activa != null && (
        <section>
          <h2>{t('fuen.anadir')}</h2>
          <div className="fila">
            <label>
              {t('fuen.tema')}{' '}
              <select value={tema ?? ''} onChange={(e) => setTema(e.target.value ? Number(e.target.value) : null)}>
                <option value="">{t('fuen.sinTema')}</option>
                {temas.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nombre}
                  </option>
                ))}
              </select>
            </label>
            <label className="boton-mini">
              {t('fuen.subir')}
              <input
                type="file"
                hidden
                multiple
                accept=".pdf,.md,.markdown,.txt,.html,.htm"
                onChange={(e) => {
                  const ficheros = Array.from(e.target.files ?? [])
                  conAviso(
                    () => Promise.all(ficheros.map((f) => subirFichero(activa, f, tema))),
                    t('fuen.enCola', { n: ficheros.length }),
                  )
                  e.target.value = ''
                }}
              />
            </label>
            <button className="boton-mini" onClick={() => irARuta('#/web')}>
              {t('fuen.guardarWeb')}
            </button>
          </div>
          <p className="nota">
            {t('fuen.carpeta')} <code>uv run magister ingerir RUTA --fuente NOMBRE</code>
          </p>
          <h2>{t('fuen.documentos')}</h2>
          {docs.length === 0 ? (
            <p className="vacio">{t('fuen.sinDocs')}</p>
          ) : (
            <table className="tabla">
              <thead>
                <tr>
                  <th>{t('fuen.col.doc')}</th>
                  <th>{t('fuen.col.estado')}</th>
                  <th>{t('fuen.col.frag')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id}>
                    <td title={d.uri}>{d.titulo}</td>
                    <td className={`estado-${d.version?.estado}`}>
                      {d.version ? textoEstado(d.version.estado) : '·'}
                      {d.que_paso ? ` · ${d.que_paso}` : d.version?.motivo ? ` · ${d.version.motivo}` : ''}
                      {d.version?.duplicado_de ? t('fuen.duplicadoDe', { id: d.version.duplicado_de }) : ''}
                      {d.version?.origen === 'research'
                        ? t('fuen.delResearch', { leccion: d.version.leccion_clave ? t('fuen.paraLeccion', { clave: d.version.leccion_clave }) : '', auto: d.version.automatica ? t('fuen.entroSolo') : '' })
                        : ''}
                      {(d.incompleta ?? d.version?.incompleta) && (
                        <span className="aviso-incompleta" role="note">
                          {avisoIncompleta((d.incompleta ?? d.version?.incompleta)!)}{' '}
                          <label className="boton-mini">
                            {t('fuen.subirPdf')}
                            <input
                              type="file"
                              hidden
                              accept=".pdf"
                              onChange={(e) => {
                                const f = e.target.files?.[0]
                                if (f && activa != null)
                                  conAviso(() => subirFichero(activa, f, d.tema_id), t('fuen.pdfEnCola', { nombre: f.name }))
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
                              conAviso(() => reintentarVersion(d.version!.id), t('fuen.reindexa', { titulo: d.titulo }))
                            }
                          >
                            {t('fuen.reintentar')}
                          </button>
                        </>
                      )}
                    </td>
                    <td>{d.fragmentos}</td>
                    <td>
                      <button
                        className="borrar"
                        aria-label={t('fuen.borrarDoc', { titulo: d.titulo })}
                        onClick={async () => {
                          if (activa == null || !confirm(t('fuen.confirmarDoc', { titulo: d.titulo }))) return
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
