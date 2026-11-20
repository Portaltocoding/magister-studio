import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  EVENTO_CAMBIO_APLICADO,
  enviarJson,
  hoyIso,
  listarPlanes,
  marcarSesion,
  pedir,
  rutaExamen,
  verCalendario,
  type HitoExamen,
  type ResumenPlan,
  type SesionVista,
} from '../api.ts'
import { agruparPorTema, alternarTema, colorDeTema, nombreCorto } from '../componentes/colorTema.ts'
import { localeActual, numero, pluralT } from '../componentes/formato.ts'
import { idiomaActual, t, type Clave } from '../i18n/i18n.ts'
import { usarIdioma } from '../i18n/usarIdioma.ts'

type Tipo = 'deber' | 'examen' | 'clase' | 'nota'

interface Evento {
  id: number
  fecha: string
  hora: string | null
  titulo: string
  tipo: Tipo
  quien: string | null
  notas: string | null
  hecho: boolean
  tema_id?: number | null
}

// Lo del plan de un día (sesiones y exámenes), para juntarlo por tema.
type DelPlan = { tipo: 'sesion'; tema_id?: number | null; s: SesionVista } | { tipo: 'examen'; tema_id?: number | null; h: HitoExamen }

interface Carga {
  fecha: string
  repasos: number
  minutos: number
}

const TIPOS_ID: Tipo[] = ['deber', 'examen', 'clase', 'nota']
const nombreTipo = (tipo: Tipo): string => t(`calendario.tipo.${tipo}` as Clave)
const DIAS = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom']

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// Las seis semanas que muestran el mes, de lunes a domingo.
function rejilla(mes: Date): Date[] {
  const primero = new Date(mes.getFullYear(), mes.getMonth(), 1)
  const desplazamiento = (primero.getDay() + 6) % 7
  const inicio = new Date(primero)
  inicio.setDate(primero.getDate() - desplazamiento)
  return Array.from({ length: 42 }, (_, i) => new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate() + i))
}

// Una sesión del plan lleva a su lección en Fichas (apuntes, fichas y diapositivas).
const abrirLeccion = (x: SesionVista) => {
  if (x.tema_id != null) window.location.hash = `#/fichas/${x.tema_id}/${x.clave}`
}

const vacio = (fecha: string) => ({ fecha, hora: '', titulo: '', tipo: 'deber' as Tipo, quien: '', notas: '' })

// Calendario: un mes de verdad. Lo tuyo (deberes, exámenes, clases, notas) va delante;
// lo del plan y los repasos previstos, detrás y con poca opacidad.
export default function PanelCalendario() {
  usarIdioma() // los textos siguen al idioma
  const [mes, setMes] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const [eventos, setEventos] = useState<Evento[]>([])
  const [sesiones, setSesiones] = useState<Record<string, SesionVista[]>>({})
  const [examenes, setExamenes] = useState<Record<string, HitoExamen[]>>({})
  const [carga, setCarga] = useState<Record<string, Carga>>({})
  const [pendientes, setPendientes] = useState<Evento[]>([])
  const [dia, setDia] = useState<string | null>(null)
  const [borrador, setBorrador] = useState(vacio(hoyIso()))
  const [editando, setEditando] = useState<number | null>(null)
  const [verPlan, setVerPlan] = useState(true)
  const hoy = hoyIso()
  const celdas = useMemo(() => rejilla(mes), [mes])
  // Cada tema (cada plan), su color y su chip en la leyenda, que además filtra.
  const [planes, setPlanes] = useState<ResumenPlan[]>([])
  const [nombresTemas, setNombresTemas] = useState<Record<number, string>>({})
  const [ocultos, setOcultos] = useState<Set<number>>(() => new Set())
  useEffect(() => {
    listarPlanes().then(setPlanes).catch(() => undefined)
    pedir<{ id: number; nombre: string }[]>('/api/temas')
      .then((ts) => setNombresTemas(Object.fromEntries(ts.map((x) => [x.id, x.nombre]))))
      .catch(() => undefined)
  }, [])

  const cargar = useCallback(() => {
    const desde = iso(celdas[0])
    const hasta = iso(celdas[41])
    pedir<Evento[]>(`/api/eventos?desde=${desde}&hasta=${hasta}`).then(setEventos).catch(() => undefined)
    pedir<Evento[]>('/api/eventos/pendientes').then(setPendientes).catch(() => undefined)
    verCalendario(desde, hasta)
      .then((dias) => {
        setSesiones(Object.fromEntries(dias.map((d) => [d.fecha, d.sesiones])))
        setExamenes(Object.fromEntries(dias.map((d) => [d.fecha, d.examenes ?? []])))
      })
      .catch(() => undefined)
    pedir<Carga[]>('/api/progreso/carga?dias=42')
      .then((c) => setCarga(Object.fromEntries(c.filter((x) => x.repasos > 0).map((x) => [x.fecha, x]))))
      .catch(() => setCarga({}))
  }, [celdas])

  useEffect(cargar, [cargar])
  // El asesor ha movido una sesión, marcado una lección o apuntado algo en tu agenda: se recarga el mes.
  useEffect(() => {
    window.addEventListener(EVENTO_CAMBIO_APLICADO, cargar)
    return () => window.removeEventListener(EVENTO_CAMBIO_APLICADO, cargar)
  }, [cargar])

  const abrir = (fecha: string) => {
    setDia(fecha)
    setEditando(null)
    setBorrador(vacio(fecha))
  }

  const guardar = async () => {
    if (!borrador.titulo.trim()) return
    const cuerpo = { ...borrador, hora: borrador.hora || null, quien: borrador.quien || null, notas: borrador.notas || null }
    if (editando) await pedir(`/api/eventos/${editando}`, enviarJson(cuerpo, 'PATCH'))
    else await pedir('/api/eventos', enviarJson(cuerpo))
    setEditando(null)
    setBorrador(vacio(borrador.fecha))
    cargar()
  }

  const alternar = async (e: Evento) => {
    await pedir(`/api/eventos/${e.id}`, enviarJson({ hecho: !e.hecho }, 'PATCH'))
    cargar()
  }

  const borrar = async (e: Evento) => {
    if (!confirm(t('calendario.confirmarBorrar', { titulo: e.titulo }))) return
    await pedir(`/api/eventos/${e.id}`, { method: 'DELETE' })
    cargar()
  }

  // Los temas de la leyenda: los de tus planes, en su orden, y detrás cualquier otro que salga en el mes.
  const temas = useMemo(() => {
    const m = new Map<number, string>()
    for (const p of planes) m.set(p.tema_id, p.tema)
    const otro = (id: number | null | undefined, nombre?: string) => {
      if (id != null && !m.has(id)) m.set(id, nombre ?? nombresTemas[id] ?? t('calendario.temaN', { id }))
    }
    for (const lista of Object.values(sesiones)) for (const x of lista) otro(x.tema_id, x.tema)
    for (const lista of Object.values(examenes)) for (const h of lista) otro(h.tema_id, h.tema)
    for (const e of [...eventos, ...pendientes]) otro(e.tema_id)
    return [...m.entries()].map(([id, nombre]) => ({ id, nombre }))
  }, [planes, nombresTemas, sesiones, examenes, eventos, pendientes])
  const orden = temas.map((x) => x.id)
  // El color, siempre sobre la misma lista (la de tus planes): así sale igual que en Roadmap, Lecciones o Examen.
  const idsPlanes = planes.map((p) => p.tema_id)
  const colorDe = (id: number | null | undefined) => colorDeTema(id, idsPlanes)
  const nombreTema = (id: number) => temas.find((x) => x.id === id)?.nombre ?? nombresTemas[id] ?? t('calendario.temaN', { id })
  const visible = (id: number | null | undefined) => id == null || !ocultos.has(id)
  const etiquetaTema = (id: number | null | undefined): ReactNode =>
    id == null ? null : (
      <span className="tema-etiqueta" style={colorDe(id)?.estilo}>
        <span className="punto-tema" aria-hidden="true" />
        {nombreTema(id)}
      </span>
    )

  const delDia = (f: string) => eventos.filter((e) => e.fecha === f && visible(e.tema_id))
  const delPlan = (f: string): DelPlan[] => [
    ...(sesiones[f] ?? []).filter((s) => visible(s.tema_id)).map((s) => ({ tipo: 'sesion' as const, tema_id: s.tema_id, s })),
    ...(examenes[f] ?? []).filter((h) => visible(h.tema_id)).map((h) => ({ tipo: 'examen' as const, tema_id: h.tema_id, h })),
  ]
  const titulo = mes.toLocaleDateString(localeActual(), { month: 'long', year: 'numeric' })

  return (
    <div className="panel calendario">
      <div className="cabecera-panel">
        <h1 className="titulo-mes">{titulo}</h1>
        <div className="botones">
          <button className="boton" onClick={() => setMes(new Date(mes.getFullYear(), mes.getMonth() - 1, 1))} aria-label={t('calendario.mesAnterior')}>
            ‹
          </button>
          <button className="boton" onClick={() => setMes(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>
            {t('calendario.hoy')}
          </button>
          <button className="boton" onClick={() => setMes(new Date(mes.getFullYear(), mes.getMonth() + 1, 1))} aria-label={t('calendario.mesSiguiente')}>
            ›
          </button>
          <button className="boton boton-principal" onClick={() => abrir(hoy)}>
            {t('calendario.apuntarMas')}
          </button>
        </div>
      </div>
      <div className="leyenda">
        {TIPOS_ID.map((x) => (
          <span key={x} className={`pastilla pastilla-${x}`}>
            {nombreTipo(x)}
          </span>
        ))}
        <label className="nota">
          <input type="checkbox" checked={verPlan} onChange={(e) => setVerPlan(e.target.checked)} /> {t('calendario.verPlan')}
        </label>
      </div>
      {temas.length > 0 && (
        <div className="leyenda-temas" role="group" aria-label={t('calendario.temasAria')}>
          {temas.map((tm) => {
            const visto = !ocultos.has(tm.id)
            const ultimo = visto && temas.every((o) => o.id === tm.id || ocultos.has(o.id))
            return (
              <button
                key={tm.id}
                type="button"
                className="chip-tema"
                style={colorDe(tm.id)?.estilo}
                aria-pressed={visto}
                aria-disabled={ultimo || undefined}
                title={ultimo ? t('calendario.siempreUno') : visto ? t('calendario.ocultar', { nombre: tm.nombre }) : t('calendario.ensenar', { nombre: tm.nombre })}
                onClick={() => setOcultos((o) => alternarTema(o, tm.id, orden))}
              >
                <span className="punto-tema" aria-hidden="true" />
                {tm.nombre}
              </button>
            )
          })}
        </div>
      )}

      <div className="mes-y-dia">
        <div className="mes" role="grid" aria-label={t('calendario.deMes', { mes: titulo })}>
          {DIAS.map((d) => (
            <div key={d} className="mes-cabecera" role="columnheader">
              {t(`calendario.dia.${d}` as Clave)}
            </div>
          ))}
          {celdas.map((c) => {
            const f = iso(c)
            const otroMes = c.getMonth() !== mes.getMonth()
            const lista = delDia(f)
            return (
              <button
                key={f}
                role="gridcell"
                className={['celda', otroMes && 'celda-fuera', f === hoy && 'celda-hoy', f === dia && 'celda-elegida']
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => abrir(f)}
                aria-label={t('calendario.celdaAria', { fecha: c.toLocaleDateString(localeActual(), { weekday: 'long', day: 'numeric', month: 'long' }), n: lista.length })}
              >
                <span className="celda-numero">{c.getDate()}</span>
                <span className="celda-cosas">
                  {lista.slice(0, 3).map((e) => (
                    <span
                      key={e.id}
                      className={`pastilla pastilla-${e.tipo} ${e.hecho ? 'pastilla-hecha' : ''}`}
                      style={colorDe(e.tema_id)?.estilo}
                      title={e.tema_id != null ? `${e.titulo} · ${nombreTema(e.tema_id)}` : e.titulo}
                    >
                      {e.tema_id != null && <span className="punto-tema" aria-hidden="true" />}
                      {e.hora ? `${e.hora} ` : ''}
                      {e.titulo}
                    </span>
                  ))}
                  {lista.length > 3 && <span className="nota-linea">{t('calendario.masN', { n: lista.length - 3 })}</span>}
                  {/* Lo del plan, junto por tema y en el orden de la leyenda: el nombre corto del tema y debajo lo suyo. */}
                  {verPlan &&
                    agruparPorTema(delPlan(f), orden).map((g) => (
                      <span key={`t${g.temaId ?? 'x'}`} className="cal-grupo" style={colorDe(g.temaId)?.estilo}>
                        {g.temaId != null && (
                          <span className="cal-grupo-nombre" title={nombreTema(g.temaId)}>
                            {nombreCorto(nombreTema(g.temaId))}
                          </span>
                        )}
                        {g.cosas.map((c) =>
                          c.tipo === 'sesion' ? (
                            <span
                              key={`s${c.s.id}`}
                              className={`fondo-plan ${g.temaId != null ? 'con-tema' : ''} ${c.s.estado === 'hecha' ? 'pastilla-hecha' : ''}`}
                              title={t('calendario.sesionTitulo', { clave: c.s.clave, titulo: c.s.titulo, tema: c.s.tema })}
                              onClick={(ev) => {
                                ev.stopPropagation()
                                abrirLeccion(c.s)
                              }}
                            >
                              {c.s.clave} {c.s.titulo}
                            </span>
                          ) : (
                            <span
                              key={`e${c.h.id}`}
                              className={`fondo-plan fondo-examen ${g.temaId != null ? 'con-tema' : ''} ${c.h.hecho ? 'pastilla-hecha' : ''}`}
                              title={t('calendario.examenTitulo', { titulo: `${c.h.titulo}${c.h.tema ? ` (${c.h.tema})` : ''}`, n: c.h.preguntas, min: c.h.minutos })}
                              onClick={(ev) => {
                                ev.stopPropagation()
                                if (c.h.plan_id) window.location.hash = rutaExamen(c.h.plan_id, c.h)
                              }}
                            >
                              {c.h.titulo}
                            </span>
                          ),
                        )}
                      </span>
                    ))}
                  {verPlan && carga[f] && <span className="fondo-plan fondo-repaso">{pluralT(carga[f].repasos, 'calendario.repaso', 'calendario.repasos')}</span>}
                </span>
              </button>
            )
          })}
        </div>

        <aside className="dia-detalle" aria-label={t('calendario.diaElegido')}>
          {dia ? (
            <>
              <h2>{new Date(dia + 'T12:00:00').toLocaleDateString(localeActual(), { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
              {delDia(dia).length === 0 && <p className="vacio">{t('calendario.nada')}</p>}
              <ul className="lista-dia">
                {delDia(dia).map((e) => (
                  <li key={e.id} className={`item-${e.tipo}`}>
                    <label>
                      <input type="checkbox" checked={e.hecho} onChange={() => alternar(e)} />{' '}
                      <span className={e.hecho ? 'tachado' : ''}>
                        {e.hora && <strong>{e.hora} </strong>}
                        {e.titulo}
                      </span>
                    </label>
                    <span className="nota-linea">
                      {nombreTipo(e.tipo)}
                      {e.quien ? ` · ${e.quien}` : ''}
                      {e.tema_id != null && <> · {etiquetaTema(e.tema_id)}</>}
                    </span>
                    {e.notas && <p className="nota">{e.notas}</p>}
                    <span className="acciones">
                      <button
                        className="boton-mini"
                        onClick={() => {
                          setEditando(e.id)
                          setBorrador({ fecha: e.fecha, hora: e.hora ?? '', titulo: e.titulo, tipo: e.tipo, quien: e.quien ?? '', notas: e.notas ?? '' })
                        }}
                      >
                        {t('calendario.editar')}
                      </button>
                      <button className="boton-mini" onClick={() => borrar(e)}>
                        {t('calendario.borrar')}
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
              {verPlan && (examenes[dia] ?? []).some((h) => visible(h.tema_id)) && (
                <>
                  <h3>{t('calendario.examenes')}</h3>
                  <ul className="lista-dia">
                    {agruparPorTema((examenes[dia] ?? []).filter((h) => visible(h.tema_id)), orden).flatMap((g) => g.cosas).map((h) => (
                      <li key={h.id} className={`item-plan ${h.tema_id != null ? 'con-tema' : ''}`} style={colorDe(h.tema_id)?.estilo}>
                        <span>
                          <strong>{h.titulo}</strong>{' '}
                          <span className="nota">
                            · {t('calendario.examenInfo', { n: h.preguntas, min: h.minutos })}
                            {h.nota != null ? t(h.hecho ? 'calendario.aprobadoCon' : 'calendario.mejorNota', { nota: idiomaActual() === 'en' ? h.nota.toFixed(1) : h.nota.toFixed(1).replace('.', ',') }) : ''}
                          </span>
                          {h.tema_id != null && <span className="nota-linea">{etiquetaTema(h.tema_id)}</span>}
                        </span>
                        <button className="boton-mini" onClick={() => h.plan_id && (window.location.hash = rutaExamen(h.plan_id, h))}>
                          {h.hecho ? t('calendario.repetir') : t('calendario.hacerlo')}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {verPlan && (sesiones[dia] ?? []).some((x) => visible(x.tema_id)) && (
                <>
                  <h3>{t('calendario.delPlan')}</h3>
                  {agruparPorTema((sesiones[dia] ?? []).filter((x) => visible(x.tema_id)), orden).map((g) => (
                    <div key={g.temaId ?? 'x'} className="dia-tema">
                      {g.temaId != null && <h4 className="dia-tema-nombre">{etiquetaTema(g.temaId)}</h4>}
                      <ul className="lista-dia">
                        {g.cosas.map((x) => (
                          <li key={x.id} className={`item-plan ${g.temaId != null ? 'con-tema' : ''}`} style={colorDe(g.temaId)?.estilo}>
                            <label>
                              <input
                                type="checkbox"
                                checked={x.estado === 'hecha'}
                                onChange={async () => {
                                  await marcarSesion(x.id, x.estado === 'hecha' ? 'pendiente' : 'hecha')
                                  cargar()
                                }}
                              />{' '}
                              {x.inicio ? `${x.inicio.slice(0, 5)} · ` : ''}
                              <strong>{x.clave}</strong> {x.titulo} <span className="nota">· {numero(x.horas, 2)} h</span>
                            </label>
                            <button className="boton-mini" onClick={() => abrirLeccion(x)} title={x.tema}>
                              {t('calendario.abrir')}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </>
              )}
              <form
                className="formulario"
                onSubmit={(ev) => {
                  ev.preventDefault()
                  guardar()
                }}
              >
                <h3>{editando ? t('calendario.editar') : t('calendario.apuntarAlgo')}</h3>
                <input
                  placeholder={t('calendario.quePh')}
                  aria-label={t('calendario.que')}
                  value={borrador.titulo}
                  onChange={(e) => setBorrador({ ...borrador, titulo: e.target.value })}
                  autoFocus
                />
                <div className="fila">
                  <select aria-label={t('calendario.tipo')} value={borrador.tipo} onChange={(e) => setBorrador({ ...borrador, tipo: e.target.value as Tipo })}>
                    {TIPOS_ID.map((k) => (
                      <option key={k} value={k}>
                        {nombreTipo(k)}
                      </option>
                    ))}
                  </select>
                  <input type="date" aria-label={t('calendario.fecha')} value={borrador.fecha} onChange={(e) => setBorrador({ ...borrador, fecha: e.target.value })} />
                  <input type="time" aria-label={t('calendario.hora')} value={borrador.hora} onChange={(e) => setBorrador({ ...borrador, hora: e.target.value })} />
                </div>
                <input
                  placeholder={t('calendario.quienPh')}
                  aria-label={t('calendario.quien')}
                  value={borrador.quien}
                  onChange={(e) => setBorrador({ ...borrador, quien: e.target.value })}
                />
                <textarea
                  placeholder={t('calendario.notasPh')}
                  aria-label={t('calendario.notas')}
                  value={borrador.notas}
                  onChange={(e) => setBorrador({ ...borrador, notas: e.target.value })}
                />
                <div className="botones">
                  <button className="boton boton-principal" disabled={!borrador.titulo.trim()}>
                    {editando ? t('calendario.guardar') : t('calendario.apuntar')}
                  </button>
                  {editando && (
                    <button type="button" className="boton" onClick={() => { setEditando(null); setBorrador(vacio(dia)) }}>
                      {t('calendario.cancelar')}
                    </button>
                  )}
                </div>
              </form>
            </>
          ) : (
            <>
              <h2>{t('calendario.pendiente')}</h2>
              {pendientes.length === 0 && <p className="vacio">{t('calendario.ningunPendiente')}</p>}
              <ul className="lista-dia">
                {pendientes.filter((e) => visible(e.tema_id)).map((e) => (
                  <li key={e.id} className={`item-${e.tipo} ${e.fecha < hoy ? 'atrasado' : ''}`}>
                    <label>
                      <input type="checkbox" checked={e.hecho} onChange={() => alternar(e)} /> {e.titulo}
                    </label>
                    <span className="nota-linea">
                      {nombreTipo(e.tipo)} · {new Date(e.fecha + 'T12:00:00').toLocaleDateString(localeActual(), { weekday: 'short', day: 'numeric', month: 'short' })}
                      {e.quien ? ` · ${e.quien}` : ''}
                      {e.fecha < hoy ? t('calendario.atrasado') : ''}
                      {e.tema_id != null && <> · {etiquetaTema(e.tema_id)}</>}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </aside>
      </div>
    </div>
  )
}
