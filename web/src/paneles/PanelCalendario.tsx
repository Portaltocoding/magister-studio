import { useCallback, useEffect, useMemo, useState } from 'react'
import { enviarJson, hoyIso, marcarSesion, pedir, rutaExamen, verCalendario, type HitoExamen, type SesionVista } from '../api.ts'

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
}

interface Carga {
  fecha: string
  repasos: number
  minutos: number
}

const TIPOS: Record<Tipo, string> = { deber: 'Deber', examen: 'Examen', clase: 'Clase', nota: 'Nota' }
const DIAS = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom']

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
    if (!confirm(`¿Borrar «${e.titulo}»?`)) return
    await pedir(`/api/eventos/${e.id}`, { method: 'DELETE' })
    cargar()
  }

  const delDia = (f: string) => eventos.filter((e) => e.fecha === f)
  const titulo = mes.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })

  return (
    <div className="panel calendario">
      <div className="cabecera-panel">
        <h1 className="titulo-mes">{titulo}</h1>
        <div className="botones">
          <button className="boton" onClick={() => setMes(new Date(mes.getFullYear(), mes.getMonth() - 1, 1))} aria-label="Mes anterior">
            ‹
          </button>
          <button className="boton" onClick={() => setMes(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>
            Hoy
          </button>
          <button className="boton" onClick={() => setMes(new Date(mes.getFullYear(), mes.getMonth() + 1, 1))} aria-label="Mes siguiente">
            ›
          </button>
          <button className="boton boton-principal" onClick={() => abrir(hoy)}>
            + Apuntar
          </button>
        </div>
      </div>
      <div className="leyenda">
        <span className="pastilla pastilla-deber">Deber</span>
        <span className="pastilla pastilla-examen">Examen</span>
        <span className="pastilla pastilla-clase">Clase</span>
        <span className="pastilla pastilla-nota">Nota</span>
        <label className="nota">
          <input type="checkbox" checked={verPlan} onChange={(e) => setVerPlan(e.target.checked)} /> Ver el plan y los repasos
        </label>
      </div>

      <div className="mes-y-dia">
        <div className="mes" role="grid" aria-label={`Calendario de ${titulo}`}>
          {DIAS.map((d) => (
            <div key={d} className="mes-cabecera" role="columnheader">
              {d}
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
                aria-label={`${c.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}: ${lista.length} cosas tuyas`}
              >
                <span className="celda-numero">{c.getDate()}</span>
                <span className="celda-cosas">
                  {lista.slice(0, 3).map((e) => (
                    <span key={e.id} className={`pastilla pastilla-${e.tipo} ${e.hecho ? 'pastilla-hecha' : ''}`} title={e.titulo}>
                      {e.hora ? `${e.hora} ` : ''}
                      {e.titulo}
                    </span>
                  ))}
                  {lista.length > 3 && <span className="nota-linea">+{lista.length - 3} más</span>}
                  {verPlan &&
                    (sesiones[f] ?? []).map((x) => (
                      <span
                        key={`s${x.id}`}
                        className={`fondo-plan ${x.estado === 'hecha' ? 'pastilla-hecha' : ''}`}
                        title={`${x.clave} ${x.titulo} (${x.tema}). Pulsa para abrirla`}
                        onClick={(ev) => {
                          ev.stopPropagation()
                          abrirLeccion(x)
                        }}
                      >
                        {x.clave} {x.titulo}
                      </span>
                    ))}
                  {verPlan &&
                    (examenes[f] ?? []).map((h) => (
                      <span
                        key={`e${h.id}`}
                        className={`fondo-plan fondo-examen ${h.hecho ? 'pastilla-hecha' : ''}`}
                        title={`${h.titulo} · ${h.preguntas} preguntas, ${h.minutos} min. Pulsa para hacerlo`}
                        onClick={(ev) => {
                          ev.stopPropagation()
                          if (h.plan_id) window.location.hash = rutaExamen(h.plan_id, h)
                        }}
                      >
                        {h.titulo}
                      </span>
                    ))}
                  {verPlan && carga[f] && <span className="fondo-plan fondo-repaso">{carga[f].repasos} {carga[f].repasos === 1 ? 'repaso' : 'repasos'}</span>}
                </span>
              </button>
            )
          })}
        </div>

        <aside className="dia-detalle" aria-label="El día elegido">
          {dia ? (
            <>
              <h2>{new Date(dia + 'T12:00:00').toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
              {delDia(dia).length === 0 && <p className="vacio">Nada apuntado.</p>}
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
                      {TIPOS[e.tipo]}
                      {e.quien ? ` · ${e.quien}` : ''}
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
                        Editar
                      </button>
                      <button className="boton-mini" onClick={() => borrar(e)}>
                        Borrar
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
              {verPlan && (examenes[dia] ?? []).length > 0 && (
                <>
                  <h3>Exámenes</h3>
                  <ul className="lista-dia">
                    {(examenes[dia] ?? []).map((h) => (
                      <li key={h.id} className="item-plan">
                        <span>
                          <strong>{h.titulo}</strong>{' '}
                          <span className="nota">
                            · {h.preguntas} preguntas, {h.minutos} min
                            {h.nota != null ? ` · ${h.hecho ? 'aprobado con' : 'mejor nota'} ${h.nota.toFixed(1).replace('.', ',')}` : ''}
                          </span>
                        </span>
                        <button className="boton-mini" onClick={() => h.plan_id && (window.location.hash = rutaExamen(h.plan_id, h))}>
                          {h.hecho ? 'Repetir →' : 'Hacerlo →'}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {verPlan && (sesiones[dia] ?? []).length > 0 && (
                <>
                  <h3>Del plan</h3>
                  <ul className="lista-dia">
                    {(sesiones[dia] ?? []).map((x) => (
                      <li key={x.id} className="item-plan">
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
                          <strong>{x.clave}</strong> {x.titulo} <span className="nota">· {x.horas} h</span>
                        </label>
                        <button className="boton-mini" onClick={() => abrirLeccion(x)} title={x.tema}>
                          Abrir →
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <form
                className="formulario"
                onSubmit={(ev) => {
                  ev.preventDefault()
                  guardar()
                }}
              >
                <h3>{editando ? 'Editar' : 'Apuntar algo'}</h3>
                <input
                  placeholder="Qué (p. ej. ejercicios 3 a 7 del tema 4)"
                  aria-label="Qué"
                  value={borrador.titulo}
                  onChange={(e) => setBorrador({ ...borrador, titulo: e.target.value })}
                  autoFocus
                />
                <div className="fila">
                  <select aria-label="Tipo" value={borrador.tipo} onChange={(e) => setBorrador({ ...borrador, tipo: e.target.value as Tipo })}>
                    {Object.entries(TIPOS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                  <input type="date" aria-label="Fecha" value={borrador.fecha} onChange={(e) => setBorrador({ ...borrador, fecha: e.target.value })} />
                  <input type="time" aria-label="Hora" value={borrador.hora} onChange={(e) => setBorrador({ ...borrador, hora: e.target.value })} />
                </div>
                <input
                  placeholder="Quién te lo asigna (opcional)"
                  aria-label="Quién te lo asigna"
                  value={borrador.quien}
                  onChange={(e) => setBorrador({ ...borrador, quien: e.target.value })}
                />
                <textarea
                  placeholder="Notas (opcional)"
                  aria-label="Notas"
                  value={borrador.notas}
                  onChange={(e) => setBorrador({ ...borrador, notas: e.target.value })}
                />
                <div className="botones">
                  <button className="boton boton-principal" disabled={!borrador.titulo.trim()}>
                    {editando ? 'Guardar' : 'Apuntar'}
                  </button>
                  {editando && (
                    <button type="button" className="boton" onClick={() => { setEditando(null); setBorrador(vacio(dia)) }}>
                      Cancelar
                    </button>
                  )}
                </div>
              </form>
            </>
          ) : (
            <>
              <h2>Pendiente</h2>
              {pendientes.length === 0 && <p className="vacio">Ningún deber ni examen pendiente. Pulsa un día para apuntar.</p>}
              <ul className="lista-dia">
                {pendientes.map((e) => (
                  <li key={e.id} className={`item-${e.tipo} ${e.fecha < hoy ? 'atrasado' : ''}`}>
                    <label>
                      <input type="checkbox" checked={e.hecho} onChange={() => alternar(e)} /> {e.titulo}
                    </label>
                    <span className="nota-linea">
                      {TIPOS[e.tipo]} · {new Date(e.fecha + 'T12:00:00').toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })}
                      {e.quien ? ` · ${e.quien}` : ''}
                      {e.fecha < hoy ? ' · atrasado' : ''}
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
