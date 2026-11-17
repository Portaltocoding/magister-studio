import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as EventoPuntero } from 'react'
import { tituloSencillo, usarIndice } from '../componentes/indice.tsx'
import Volcado from '../componentes/Volcado.tsx'
import Companera from '../componentes/Companera.tsx'
import MapaConceptos, { usarMapa } from '../componentes/MapaConceptos.tsx'
import Calentamiento, { ApuestasRevisadas, guardarCalentamiento, leerCalentamiento, type Apuestas, type DatosCalentamiento } from '../componentes/Calentamiento.tsx'
import Markdown from 'react-markdown'
import { flujo, listarPlanes, marcarSesion, pedir, rutaExamen, verPlan, type HitoExamen } from '../api.ts'
import { Tex, TextoLibro } from '../componentes/LectorLibro.tsx'
import MarcoFoco, { pedirPantallaCompleta, reloj } from '../componentes/MarcoFoco.tsx'
import Vacio, { irARuta } from '../componentes/Vacio.tsx'
import Mascota from '../Mascota.tsx'
import type { IdModo } from '../modos.ts'

export interface Hoy {
  estado: 'propuesta' | 'adelantar' | 'sin_preparar' | 'sin_plan' | 'solo_repaso'
  sesion_id?: number
  plan_id?: number
  tema_id?: number
  tema?: string
  leccion_clave?: string
  titulo?: string
  horas?: number
  material_id?: number | null
  repasos: number
  nuevos?: number
  dia?: { clave: string; titulo: string; horas: number; estado: string; sesion_id?: number; plan_id?: number; material_id?: number | null }[]
  temas?: { clave: string; titulo: string; material_id: number }[]
  razon?: string
  // El examen del plan que ya toca y aún no has aprobado.
  examen?: HitoExamen | null
}

interface Bloque {
  clave: string
  titulo: string
  texto: string
  pregunta: { pregunta_id: string; enunciado: string; concepto_id: string } | null
}

interface Definicion {
  termino: string
  ingles: string | null
  definicion: string
}

interface Formula {
  nombre: string
  latex: string
  significado: string
}

export interface Leccion {
  material_id: number
  plan_id?: number
  leccion_clave: string
  titulo: string
  tema: string
  bloques: Bloque[]
  calentamiento?: DatosCalentamiento
  definiciones: Definicion[]
  formulas: Formula[]
}

// Una lección que se puede estudiar en foco: la de hoy u otra con apuntes.
interface Opcion {
  clave: string
  titulo: string
  material_id: number | null // null: aún sin preparar
  plan_id: number
  tema_id: number
}

// Lo que llevas de una lección, para seguir donde lo dejaste.
interface Avance {
  i: number
  comprobado: Record<string, string>
  segundos: number
}

const CONFIANZAS: [number, string][] = [
  [0.25, 'No lo sé'],
  [0.5, 'Dudo'],
  [0.75, 'Bastante seguro'],
  [0.95, 'Seguro'],
]


// El ritmo del foco no va escrito en piedra: cada cuánto paras y cuándo reexplicas lo eliges tú.
interface Ritmo {
  pausa: number // minutos; 0 = sin aviso
  reexplicar: 'pausa' | 'idea' | 'dos' | 'pedir'
}
const RITMO_DEFECTO: Ritmo = { pausa: 25, reexplicar: 'pausa' }
function leerRitmo(): Ritmo {
  try {
    return { ...RITMO_DEFECTO, ...JSON.parse(localStorage.getItem('magister-ritmo') ?? '{}') }
  } catch {
    return RITMO_DEFECTO
  }
}
function guardarRitmo(r: Ritmo) {
  try {
    localStorage.setItem('magister-ritmo', JSON.stringify(r))
  } catch {
    /* sin almacenamiento */
  }
}
const DESCANSO = 5 * 60

// El ancho de la página del foco: lo eliges en Ajustes o arrastrando su borde derecho.
const ANCHOS: [number, string][] = [
  [640, 'Estrecha'],
  [780, 'Normal'],
  [1000, 'Ancha'],
  [4000, 'Toda la pantalla'],
]
const ANCHO_MIN = 480
function leerAncho(): number {
  try {
    const n = Number(localStorage.getItem('magister-ancho-papel'))
    return n >= ANCHO_MIN ? n : 780
  } catch {
    return 780
  }
}
function guardarAncho(n: number) {
  try {
    localStorage.setItem('magister-ancho-papel', String(Math.round(n)))
  } catch {
    /* sin almacenamiento */
  }
}

// El asa del borde derecho de la página: arrastrar para ensanchar o estrechar; doble clic, vuelve a la normal.
function AsaAncho({ ancho, alCambiar, papel }: { ancho: number; alCambiar: (n: number) => void; papel: HTMLElement | null }) {
  const empezar = (e: EventoPuntero<HTMLDivElement>) => {
    e.preventDefault()
    const x0 = e.clientX
    // Si el ancho guardado es mayor que el sitio que hay, se parte del real.
    const real = papel?.getBoundingClientRect().width ?? ancho
    const desde = Math.min(ancho, real)
    const asa = e.currentTarget
    asa.setPointerCapture(e.pointerId)
    document.body.classList.add('redimensionando')
    // La página va centrada: al mover un borde, crecen los dos; por eso el doble.
    const mover = (ev: PointerEvent) => alCambiar(Math.max(ANCHO_MIN, desde + (ev.clientX - x0) * 2))
    const soltar = () => {
      asa.removeEventListener('pointermove', mover)
      asa.removeEventListener('pointerup', soltar)
      document.body.classList.remove('redimensionando')
    }
    asa.addEventListener('pointermove', mover)
    asa.addEventListener('pointerup', soltar)
  }
  return (
    <div
      className="foco-asa"
      role="separator"
      aria-orientation="vertical"
      aria-label="Ancho de la página"
      aria-valuenow={Math.round(ancho)}
      tabIndex={0}
      title="Arrastra para cambiar el ancho de la página (doble clic: la normal)"
      onPointerDown={empezar}
      onDoubleClick={() => alCambiar(780)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') alCambiar(Math.max(ANCHO_MIN, ancho - 40))
        if (e.key === 'ArrowRight') alCambiar(ancho + 40)
      }}
    />
  )
}

const claveAvance = (mid: number) => `magister-foco-${mid}`
export function leerAvance(mid: number): Avance | null {
  try {
    const t = localStorage.getItem(claveAvance(mid))
    return t ? (JSON.parse(t) as Avance) : null
  } catch {
    return null
  }
}
function guardarAvance(mid: number, a: Avance | null) {
  try {
    if (a) localStorage.setItem(claveAvance(mid), JSON.stringify(a))
    else localStorage.removeItem(claveAvance(mid))
  } catch {
    /* sin almacenamiento: se empieza de cero */
  }
}

export const NOTA: Record<string, string> = { perfecta: 'Perfecta', bien: 'Bien', parcial: 'A medias', fallo: 'Fallada', saltada: 'Saltada' }

export async function cargarLeccion(mid: number): Promise<Leccion> {
  const l = await pedir<Omit<Leccion, 'material_id'>>(`/api/tutor/leccion/${mid}`)
  return { ...l, material_id: mid, formulas: l.formulas ?? [] }
}

// Una comprobación al final de cada idea: respondes de memoria y el tutor corrige.
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
    <div className="foco-comprobar">
      <span className="foco-etq">Comprueba que lo tienes</span>
      <div className="foco-pregunta">
        <Markdown>{pregunta.enunciado}</Markdown>
      </div>
      <textarea
        value={respuesta}
        disabled={!!nota || enviando}
        onChange={(e) => setRespuesta(e.target.value)}
        placeholder="Con tus palabras, sin mirar arriba"
        aria-label="Tu respuesta"
      />
      {!nota && (
        <div className="foco-confianza">
          <span>¿Cómo de seguro estás?</span>
          {CONFIANZAS.map(([v, t]) => (
            <button key={v} className="opcion opcion-chip" aria-pressed={confianza === v} data-elegida={confianza === v} onClick={() => setConfianza(v)}>
              {t}
            </button>
          ))}
          <button className="boton boton-principal" disabled={enviando || !respuesta.trim() || confianza == null} onClick={enviar}>
            {enviando ? 'Corrigiendo…' : 'Comprobar'}
          </button>
        </div>
      )}
      {(nota || explicacion) && (
        <div className={`correccion nota-${nota ?? ''}`}>
          {nota && <strong>{NOTA[nota] ?? nota}</strong>}
          <Markdown>{explicacion}</Markdown>
        </div>
      )}
    </div>
  )
}

// El panel lateral: términos de la lección y, si las hay, sus fórmulas.
function Glosario({ leccion, alCerrar }: { leccion: Leccion; alCerrar: () => void }) {
  const [vista, setVista] = useState<'terminos' | 'formulas'>(leccion.definiciones.length ? 'terminos' : 'formulas')
  return (
    <aside className="foco-glosario" aria-label="Términos y fórmulas">
      <div className="foco-glosario-cabecera">
        <div className="foco-glosario-pestanas" role="tablist">
          {leccion.definiciones.length > 0 && (
            <button role="tab" aria-selected={vista === 'terminos'} onClick={() => setVista('terminos')}>
              Términos <small>{leccion.definiciones.length}</small>
            </button>
          )}
          {leccion.formulas.length > 0 && (
            <button role="tab" aria-selected={vista === 'formulas'} onClick={() => setVista('formulas')}>
              Fórmulas <small>{leccion.formulas.length}</small>
            </button>
          )}
        </div>
        <button className="foco-boton" onClick={alCerrar}>
          Cerrar
        </button>
      </div>
      {vista === 'terminos' ? (
        <dl>
          {leccion.definiciones.map((d) => (
            <div key={d.termino}>
              <dt>
                {d.termino} {d.ingles && d.ingles !== d.termino && <small>{d.ingles}</small>}
              </dt>
              <dd>{d.definicion}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <dl className="foco-formulas">
          {leccion.formulas.map((f) => (
            <div key={f.nombre}>
              <dt>{f.nombre}</dt>
              <dd className="foco-formula">
                <Tex latex={f.latex} bloque />
              </dd>
              <dd>{f.significado}</dd>
            </div>
          ))}
        </dl>
      )}
    </aside>
  )
}

interface PropsFoco {
  leccion: Leccion
  // Solo si es la sesión de hoy: al cerrar se marca hecha en el calendario.
  sesionId?: number
  horas?: number
  repasos: number
  inicial: Avance | null
  alSalir: () => void
  irA: (m: IdModo) => void
}

// Una lección en modo foco: una idea cada vez, con su comprobación.
export function FocoLeccion({ leccion, sesionId, horas, repasos, inicial, alSalir, irA }: PropsFoco) {
  const { bloques } = leccion
  const mid = leccion.material_id
  const [i, setI] = useState(inicial?.i ?? 0)
  const [comprobado, setComprobado] = useState<Record<string, string>>(inicial?.comprobado ?? {})
  const [segundos, setSegundos] = useState(inicial?.segundos ?? 0)
  const [pausado, setPausado] = useState(false)
  const [descanso, setDescanso] = useState<number | null>(null)
  const [avisoPausa, setAvisoPausa] = useState(false)
  const [glosario, setGlosario] = useState(false)
  const [cerrada, setCerrada] = useState(false)
  // Calentamiento (priming): antes de la primera idea, si no lo has hecho ya con esta lección y empiezas de cero.
  const previo = leerCalentamiento(mid)
  const hayCalentamiento = !!leccion.calentamiento && (leccion.calentamiento.mapa.length > 0 || leccion.calentamiento.previas.length > 0)
  const [calentando, setCalentando] = useState(hayCalentamiento && !previo?.hecho && !inicial)
  const [apuestas, setApuestas] = useState<Apuestas>(previo?.apuestas ?? {})
  // Cada 25 minutos: reexplicar lo que llevas antes de la pausa.
  const [reexplicando, setReexplicando] = useState(false)
  const [ritmo, setRitmo] = useState<Ritmo>(leerRitmo)
  const [ancho, setAncho] = useState<number>(leerAncho)
  const cambiarAncho = (n: number) => {
    setAncho(n)
    guardarAncho(n)
  }
  const [verMapa, setVerMapa] = useState(false)
  const { mapa, cambiar: cambiarMapa, anadir: anadirAlMapa } = usarMapa(mid)
  const [papel, setPapel] = useState<HTMLDivElement | null>(null)
  const [seleccion, setSeleccion] = useState<{ texto: string; x: number; y: number } | null>(null)
  const ideasDesdeReexplicar = useRef(0)
  const indiceFoco = usarIndice(leccion.plan_id)
  const tituloFoco = tituloSencillo(indiceFoco, leccion.leccion_clave, leccion.titulo)

  const b = bloques[i]
  const ultimo = i === bloques.length - 1
  const puedeSeguir = !b.pregunta || !!comprobado[b.clave]
  const hayGlosario = leccion.definiciones.length + leccion.formulas.length > 0

  // Reloj: solo cuenta con la pestaña a la vista, sin pausa y sin descanso.
  useEffect(() => {
    if (pausado || descanso != null || cerrada) return
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') setSegundos((s) => s + 1)
    }, 1000)
    return () => clearInterval(t)
  }, [pausado, descanso, cerrada])

  useEffect(() => {
    if (ritmo.pausa > 0 && segundos > 0 && segundos % (ritmo.pausa * 60) === 0) setAvisoPausa(true)
  }, [segundos])

  useEffect(() => {
    if (descanso == null) return
    if (descanso <= 0) {
      setDescanso(null)
      return
    }
    const t = setTimeout(() => setDescanso((d) => (d == null ? null : d - 1)), 1000)
    return () => clearTimeout(t)
  }, [descanso])

  useEffect(() => {
    if (!cerrada) guardarAvance(mid, { i, comprobado, segundos })
  }, [mid, i, comprobado, segundos, cerrada])

  useEffect(() => {
    document.querySelector('.foco-cuerpo')?.scrollTo({ top: 0 })
  }, [i, cerrada])

  const ir = useCallback(
    (d: number) => {
      if (d > 0 && (!puedeSeguir || ultimo)) return
      if (d > 0 && leccion.plan_id != null && (ritmo.reexplicar === 'idea' || ritmo.reexplicar === 'dos')) {
        ideasDesdeReexplicar.current += 1
        if (ideasDesdeReexplicar.current >= (ritmo.reexplicar === 'idea' ? 1 : 2)) {
          ideasDesdeReexplicar.current = 0
          setReexplicando(true)
        }
      }
      setI((x) => Math.max(0, Math.min(bloques.length - 1, x + d)))
    },
    [puedeSeguir, ultimo, bloques.length, ritmo.reexplicar, leccion.plan_id],
  )

  const teclas = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && glosario) {
        setGlosario(false)
        return true
      }
      if (cerrada || descanso != null) return false
      if (e.key === 'ArrowRight') ir(1)
      else if (e.key === 'ArrowLeft') ir(-1)
      else if (e.key === 'g' && hayGlosario) setGlosario((g) => !g)
      else if (e.key === 'm') setVerMapa((v) => !v)
      else return false
      return true
    },
    [ir, glosario, cerrada, descanso, hayGlosario],
  )

  const cerrar = async () => {
    if (sesionId) await marcarSesion(sesionId, 'hecha')
    guardarAvance(mid, null)
    setCerrada(true)
  }

  const notas = Object.values(comprobado)
  const flojas = Object.entries(comprobado).filter(([, n]) => ['fallo', 'parcial', 'saltada'].includes(n))
  const previsto = (horas ?? 0) * 3600

  return (
    <MarcoFoco
      titulo={tituloFoco}
      placa={leccion.leccion_clave}
      leccion={leccion.leccion_clave}
      alSalir={alSalir}
      teclas={teclas}
      pasos={
        <ol className="foco-pasos" aria-label="Ideas de la lección">
          {bloques.map((x, k) => (
            <li key={x.clave}>
              <button
                className={`foco-paso ${k === i && !cerrada ? 'actual' : ''} ${comprobado[x.clave] ? `nota-${comprobado[x.clave]}` : k < i || cerrada ? 'vista' : ''}`}
                title={`${k + 1}. ${x.titulo}`}
                aria-label={`Idea ${k + 1}: ${x.titulo}`}
                disabled={cerrada || (k > i && !bloques.slice(i, k).every((y) => !y.pregunta || comprobado[y.clave]))}
                onClick={() => setI(k)}
              />
            </li>
          ))}
        </ol>
      }
      reloj={
        <button className={`foco-reloj ${pausado ? 'pausado' : ''}`} onClick={() => setPausado(!pausado)} title={pausado ? 'Seguir' : 'Pausar el reloj'}>
          {pausado ? '▶' : '❚❚'} {reloj(segundos)}
          {previsto > 0 && <small> / {reloj(previsto)}</small>}
        </button>
      }
      herramientas={
        <>
          {hayGlosario && (
            <button className="foco-boton" aria-pressed={glosario} onClick={() => { setGlosario(!glosario); setVerMapa(false) }} title="Términos y fórmulas (G)">
              {leccion.formulas.length ? 'Términos y fórmulas' : 'Términos'}
            </button>
          )}
          <button className="foco-boton" aria-pressed={verMapa} onClick={() => { setVerMapa(!verMapa); setGlosario(false) }} title="Tu mapa de palabras clave (M)">
            Mi mapa{mapa?.nodos.length ? ` · ${mapa.nodos.length}` : ''}
          </button>
          {leccion.plan_id != null && !cerrada && !calentando && (
            <button className="foco-boton" onClick={() => setReexplicando(true)} title="Explícate sin mirar lo que llevas">
              Reexplicar
            </button>
          )}
        </>
      }
      aviso={
        avisoPausa &&
        descanso == null &&
        !cerrada && (
          <div className="foco-aviso" role="status">
            Llevas {Math.round(segundos / 60)} minutos concentrado. Una pausa corta ahora hace que lo siguiente entre mejor.
            {leccion.plan_id != null && ritmo.reexplicar === 'pausa' && (
              <button className="boton boton-principal" onClick={() => { setAvisoPausa(false); setReexplicando(true) }} title="Explícate sin mirar lo que llevas; luego la pausa">
                Reexplica lo que llevas
              </button>
            )}
            <button className="boton" onClick={() => { setAvisoPausa(false); setDescanso(DESCANSO) }}>
              Pausa de 5 min
            </button>
            <button className="boton" onClick={() => setAvisoPausa(false)}>
              Sigo
            </button>
          </div>
        )
      }
      ajustes={
        <span className="foco-ritmo-ajustes">
          <span className="foco-ancho">
            Ancho de la página
            <span className="foco-ancho-opciones">
              {ANCHOS.map(([n, t]) => (
                <button key={n} type="button" className="foco-boton" aria-pressed={Math.abs(ancho - n) < 20} onClick={() => cambiarAncho(n)}>
                  {t}
                </button>
              ))}
            </span>
            <small>También puedes arrastrar el borde derecho de la página.</small>
          </span>
          <label>
            Pausa
            <select value={ritmo.pausa} onChange={(e) => { const r = { ...ritmo, pausa: Number(e.target.value) }; setRitmo(r); guardarRitmo(r) }}>
              {[15, 25, 40, 50].map((m) => (
                <option key={m} value={m}>
                  cada {m} min
                </option>
              ))}
              <option value={0}>sin aviso</option>
            </select>
          </label>
          <label>
            Reexplicar
            <select value={ritmo.reexplicar} onChange={(e) => { const r = { ...ritmo, reexplicar: e.target.value as Ritmo['reexplicar'] }; setRitmo(r); guardarRitmo(r) }}>
              <option value="pausa">en cada pausa</option>
              <option value="idea">al acabar cada idea</option>
              <option value="dos">cada dos ideas</option>
              <option value="pedir">solo cuando yo quiera</option>
            </select>
          </label>
        </span>
      }
      lateral={
        glosario ? (
          <Glosario leccion={leccion} alCerrar={() => setGlosario(false)} />
        ) : verMapa && mapa ? (
          <aside className="foco-glosario foco-mapa" aria-label="Tu mapa de palabras clave">
            <div className="foco-glosario-cabecera">
              <strong>Tu mapa</strong>
              <button className="foco-boton" onClick={() => setVerMapa(false)}>
                Cerrar
              </button>
            </div>
            <p className="nota">
              Pocas palabras y una flecha solo si sabes explicar la relación. Selecciona texto en los apuntes para traerlo aquí.
            </p>
            <MapaConceptos mapa={mapa} alCambiar={cambiarMapa} />
          </aside>
        ) : null
      }
      pie={
        calentando ? (
          <>
            <span className="foco-atajos">Unos minutos para tener el mapa antes de los detalles.</span>
            <button
              className="boton-mini"
              onClick={() => {
                guardarCalentamiento(mid, {})
                setCalentando(false)
              }}
            >
              Saltar el calentamiento
            </button>
          </>
        ) : !cerrada &&
        descanso == null && (
          <>
            <button className="boton" disabled={i === 0} onClick={() => ir(-1)}>
              ← Anterior
            </button>
            <span className="foco-atajos">
              {puedeSeguir
                ? `← → para moverte · L lupa${hayGlosario ? ' · G términos' : ''} · Esc salir`
                : 'Para seguir, contesta la comprobación del final de la idea (o sáltala).'}
            </span>
            {b.pregunta && !comprobado[b.clave] && (
              <button className="boton-mini" onClick={() => setComprobado((c) => ({ ...c, [b.clave]: 'saltada' }))}>
                Saltar la comprobación
              </button>
            )}
            {ultimo ? (
              <button className="boton boton-principal" disabled={!puedeSeguir} onClick={cerrar}>
                Cerrar la sesión
              </button>
            ) : (
              <button className="boton boton-principal" disabled={!puedeSeguir} onClick={() => ir(1)}>
                Siguiente idea →
              </button>
            )}
          </>
        )
      }
    >
      {descanso != null ? (
        <section className="foco-descanso">
          <span className="foco-etq">Descanso</span>
          <strong>{reloj(descanso)}</strong>
          <p>Levántate, mira lejos, bebe agua. Nada de pantallas: el cerebro ordena lo que acabas de leer mientras no haces nada.</p>
          <button className="boton" onClick={() => setDescanso(null)}>
            Volver ya
          </button>
        </section>
      ) : reexplicando && leccion.plan_id != null ? (
        <Volcado
          planId={leccion.plan_id}
          clave={leccion.leccion_clave}
          titulo={tituloFoco}
          alcance={bloques.slice(0, i + 1).map((x) => x.clave)}
          apoyo={mapa && mapa.nodos.length > 0 ? <MapaConceptos mapa={mapa} soloVer /> : undefined}
          alEstudiar={(k) => {
            const n = bloques.findIndex((x) => x.clave === k)
            if (n >= 0) setI(n)
            setReexplicando(false)
          }}
          alCerrar={() => {
            setReexplicando(false)
            setDescanso(DESCANSO)
          }}
        />
      ) : calentando && leccion.calentamiento ? (
        <Calentamiento
          mid={mid}
          datos={leccion.calentamiento}
          alTerminar={(a) => {
            setApuestas(a)
            guardarCalentamiento(mid, a)
            setCalentando(false)
          }}
        />
      ) : cerrada ? (
        <section className="foco-cierre">
          <span className="foco-etq">Sesión hecha</span>
          <h1>{tituloFoco}</h1>
          <div className="foco-cifras">
            <div>
              <strong>{reloj(segundos)}</strong>
              <span>de estudio</span>
            </div>
            <div>
              <strong>{bloques.length}</strong>
              <span>ideas</span>
            </div>
            <div>
              <strong>
                {notas.filter((n) => n === 'bien' || n === 'perfecta').length} de {bloques.filter((x) => x.pregunta).length}
              </strong>
              <span>comprobaciones bien</span>
            </div>
          </div>
          {leccion.calentamiento && <ApuestasRevisadas previas={leccion.calentamiento.previas} apuestas={apuestas} />}
          {flojas.length > 0 ? (
            <>
              <p>Esto vuelve en tu repaso, antes que lo demás:</p>
              <ul className="foco-flojas">
                {flojas.map(([k, n]) => (
                  <li key={k}>
                    {bloques.find((x) => x.clave === k)?.titulo ?? k} <span className={`chip nota-${n}`}>{NOTA[n] ?? n}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p>Todo bien. Los conceptos de hoy volverán en el repaso justo antes de que se te olviden.</p>
          )}
          <div className="botones">
            {(repasos > 0 || flojas.length > 0) && (
              <button className="boton boton-principal" onClick={() => { alSalir(); irA('repaso') }}>
                Repasar ahora
              </button>
            )}
            <button className="boton" onClick={() => { alSalir(); irA('examen') }}>
              Examinarme de esta lección
            </button>
            <button className="boton" onClick={alSalir}>
              Salir del foco
            </button>
          </div>
        </section>
      ) : (
        <article className="foco-idea foco-lectura" style={{ '--ancho-papel': `${ancho}px` } as CSSProperties}>
          <span className="foco-etq">
            Idea {i + 1} de {bloques.length}
          </span>
          <h1>{b.titulo}</h1>
          <div
            className="foco-papel-envoltura"
            ref={setPapel}
            onMouseUp={() => {
              const sel = window.getSelection()
              const t = sel?.toString().trim() ?? ''
              if (t.length >= 2 && t.length <= 60 && sel?.rangeCount) {
                const r = sel.getRangeAt(0).getBoundingClientRect()
                const caja = papel?.getBoundingClientRect()
                if (caja) setSeleccion({ texto: t, x: r.left - caja.left + r.width / 2, y: r.top - caja.top })
              } else setSeleccion(null)
            }}
          >
            <TextoLibro markdown={b.texto} className="foco-papel" />
            <AsaAncho ancho={ancho} alCambiar={cambiarAncho} papel={papel} />
            {seleccion && (
              <button
                className="al-mapa"
                style={{ left: seleccion.x, top: seleccion.y }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  anadirAlMapa([seleccion.texto])
                  setSeleccion(null)
                  setVerMapa(true)
                  setGlosario(false)
                  window.getSelection()?.removeAllRanges()
                }}
              >
                + Al mapa
              </button>
            )}
            <Companera key={b.clave} mid={mid} claveBloque={b.clave} papel={papel} alPalabras={(ps) => anadirAlMapa(ps)} enMapa={mapa?.nodos.map((n) => n.texto) ?? []} />
          </div>
          {b.pregunta && !comprobado[b.clave] && (
            <Comprobar key={b.clave} pregunta={b.pregunta} alAcabar={(n) => setComprobado((c) => ({ ...c, [b.clave]: n }))} />
          )}
          {b.pregunta && comprobado[b.clave] && (
            <p className={`foco-hecho nota-${comprobado[b.clave]}`}>Comprobada: {NOTA[comprobado[b.clave]] ?? comprobado[b.clave]}</p>
          )}
        </article>
      )}
    </MarcoFoco>
  )
}

// Si hoy (o antes) tocaba un examen del plan y no lo has aprobado, el tutor te lo propone.
// «Tu día»: lo que toca, en orden (repasar, las lecciones, el examen al final) y cuánto queda.
function TuDia({ hoy, minutosRepaso, irA }: { hoy: Hoy; minutosRepaso: number | null; irA: (m: IdModo) => void }) {
  const dia = hoy.dia ?? []
  const indice = usarIndice(hoy.plan_id)
  if (!dia.length && !hoy.examen && !hoy.temas?.length) return null
  const horas = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',')
  const quedan = dia.filter((s) => s.estado !== 'hecha').reduce((a, s) => a + s.horas, 0) +
    (hoy.repasos ? (minutosRepaso ?? hoy.repasos * 2) / 60 : 0) + (hoy.examen && !hoy.examen.hecho ? hoy.examen.minutos / 60 : 0)
  let n = 0
  return (
    <section className="tu-dia">
      <h2>
        Lo que toca <small>{quedan > 0 ? `quedan unas ${horas(quedan)} h` : 'todo hecho'}</small>
      </h2>
      <ol>
        {(hoy.temas ?? []).map((t) => (
          <li key={`tema-${t.clave}`}>
            <span className="tu-dia-num">{++n}</span>
            <button className="enlace" onClick={() => irA('repaso')}>
              Recordar entera <b className="tu-dia-clave">{t.clave}</b> {tituloSencillo(indice, t.clave, t.titulo)}
            </button>
            <small>repaso del tema</small>
          </li>
        ))}
        {hoy.repasos > 0 && (
          <li>
            <span className="tu-dia-num">{++n}</span>
            <button className="enlace" onClick={() => irA('repaso')}>
              Repasar {hoy.repasos} {hoy.repasos === 1 ? 'concepto' : 'conceptos'}
            </button>
            <small>unos {minutosRepaso ?? '·'} min</small>
          </li>
        )}
        {dia.map((s) => (
          <li key={s.clave} className={s.estado === 'hecha' ? 'hecho' : ''}>
            <span className="tu-dia-num">{s.estado === 'hecha' ? '✓' : ++n}</span>
            <span>
              <b className="tu-dia-clave">{s.clave}</b> {tituloSencillo(indice, s.clave, s.titulo)}
            </span>
            <small>{horas(s.horas)} h</small>
          </li>
        ))}
        {hoy.examen && (
          <li className={hoy.examen.hecho ? 'hecho' : ''}>
            <span className="tu-dia-num">{hoy.examen.hecho ? '✓' : ++n}</span>
            <span>{hoy.examen.titulo}</span>
            <small>{hoy.examen.minutos} min</small>
          </li>
        )}
      </ol>
    </section>
  )
}

function TarjetaExamen({ examen, despues }: { examen: HitoExamen; despues?: string[] }) {
  const atrasado = examen.fecha < new Date().toISOString().slice(0, 10)
  return (
    <section className="tutor-examen">
      <div>
        <span className="vacio-etq">{atrasado ? 'Examen pendiente' : 'Hoy toca examen'}</span>
        <strong>{examen.titulo}</strong>
        <small>
          {examen.preguntas} preguntas · {examen.minutos} min
          {despues?.length ? ` · mejor al acabar ${despues.join(' y ')}` : ''}
          {examen.nota != null ? ` · tu mejor nota: ${examen.nota.toFixed(1).replace('.', ',')} (se aprueba con 5)` : ''}
        </small>
      </div>
      {examen.plan_id && (
        <button className="boton boton-principal" onClick={() => irARuta(rutaExamen(examen.plan_id!, examen))}>
          Hacer el examen
        </button>
      )}
    </section>
  )
}

export const saludo = () => {
  const h = new Date().getHours()
  return h < 6 ? 'Buenas noches' : h < 14 ? 'Buenos días' : h < 21 ? 'Buenas tardes' : 'Buenas noches'
}

// «Hoy»: tus cifras, tu día y la lección de hoy (el tutor que te guía está en PanelGuia).
// vista «foco»: su propia entrada en la barra lateral, con todas las lecciones para elegir.
export default function PanelTutor({ irA, vista = 'hoy' }: { irA: (m: IdModo) => void; vista?: 'hoy' | 'foco' }) {
  const [hoy, setHoy] = useState<Hoy | null>(null)
  const indiceHoy = usarIndice(hoy?.plan_id)
  const [leccion, setLeccion] = useState<Leccion | null>(null)
  const [otras, setOtras] = useState<Opcion[]>([])
  const [avance, setAvance] = useState<Avance | null>(null)
  const [minutosRepaso, setMinutosRepaso] = useState<number | null>(null)
  const [semana, setSemana] = useState<{ hechas: number; total: number; sesiones: number; hechasN: number } | null>(null)

  const abrir = useCallback(async (mid: number) => {
    setAvance(leerAvance(mid))
    setLeccion(await cargarLeccion(mid))
  }, [])

  useEffect(() => {
    // #/hoy/foco entra en la lección de hoy; #/hoy/foco/12, en la de esos apuntes.
    // En la vista foco, #/foco abre la lista, #/foco/hoy la de hoy y #/foco/12 esos apuntes.
    // #/foco abre la lista; #/foco/12, esos apuntes directamente.
    const partes = window.location.hash.replace(/^#\/?/, '').split('/')
    const foco = vista === 'foco' ? (partes[1] ? 'foco' : null) : partes[1]
    const mid = vista === 'foco' ? (partes[1] === 'hoy' ? '' : partes[1]) : partes[2]
    if (foco === 'foco') window.history.replaceState(null, '', vista === 'foco' ? '#/foco' : '#/hoy')
    pedir<Hoy>('/api/hoy').then((h) => {
      setHoy(h)
      if (h.material_id) setAvance(leerAvance(h.material_id))
      if (foco === 'foco') {
        const elegido = Number(mid) || (h.estado !== 'sin_preparar' ? h.material_id : null)
        if (elegido) abrir(elegido)
      }
    })
    pedir<{ minutos: number }[]>('/api/practica/cola').then((c) => setMinutosRepaso(Math.round(c.reduce((a, x) => a + x.minutos, 0))))
    listarPlanes().then(async (ps) => {
      // Esta semana: horas y sesiones hechas frente a las previstas (lunes a domingo).
      if (ps[0]) {
        const v = await verPlan(ps[0].tema_id)
        const hoyIso = new Date().toISOString().slice(0, 10)
        const s = v.semanas.find((w) => w.dias.some((d) => d.fecha === hoyIso)) ?? v.semanas[0]
        const ses = s ? s.dias.flatMap((d) => d.sesiones) : []
        setSemana({
          total: ses.reduce((a, x) => a + x.horas, 0),
          hechas: ses.filter((x) => x.estado === 'hecha').reduce((a, x) => a + x.horas, 0),
          sesiones: ses.length,
          hechasN: ses.filter((x) => x.estado === 'hecha').length,
        })
      }
      const lista: Opcion[] = []
      for (const p of ps) {
        const [v, estados] = await Promise.all([
          verPlan(p.tema_id),
          pedir<Record<string, { apuntes_id?: number }>>(`/api/planes/${p.plan_id}/materiales`),
        ])
        for (const l of v.lecciones) {
          lista.push({ clave: l.clave, titulo: l.titulo, material_id: estados[l.clave]?.apuntes_id ?? null, plan_id: p.plan_id, tema_id: p.tema_id })
        }
      }
      setOtras(lista)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abrir])

  const empezar = (mid: number, desdeCero = false) => {
    if (desdeCero) guardarAvance(mid, null)
    pedirPantallaCompleta()
    abrir(mid)
  }

  if (!hoy) return <p className="vacio">Preparando…</p>

  if (leccion)
    return (
      <FocoLeccion
        key={leccion.material_id}
        leccion={leccion}
        sesionId={leccion.material_id === hoy.material_id ? hoy.sesion_id : undefined}
        horas={leccion.material_id === hoy.material_id ? hoy.horas : undefined}
        repasos={hoy.repasos}
        inicial={avance}
        irA={irA}
        alSalir={() => {
          setLeccion(null)
          if (hoy.material_id) setAvance(leerAvance(hoy.material_id))
        }}
      />
    )

  if (vista === 'foco') return <ElegirFoco hoy={hoy} otras={otras} empezar={empezar} />

  if (hoy.estado === 'sin_plan')
    return (
      <div className="panel">
        <Vacio
          etiqueta="Tutor"
          titulo="Aún no tienes un plan"
          texto="El tutor te dice cada día qué toca y te lo explica idea a idea, en modo foco: pantalla completa, sin menús, con una comprobación al final de cada idea."
          acciones={[{ texto: 'Crear mi plan', principal: true, alPulsar: () => irARuta('#/nuevo-plan') }]}
        />
      </div>
    )

  const seguir = avance && hoy.material_id ? `Seguir por la idea ${avance.i + 1}` : null
  // Si el examen cubre lecciones que aún tienes pendientes hoy, va después de ellas.
  const examenDespues = hoy.examen
    ? (hoy.dia ?? []).filter((s) => s.estado !== 'hecha' && hoy.examen!.lecciones?.includes(s.clave)).map((s) => s.clave)
    : []

  return (
    <div className="tutor-inicio">
      <header className="hoy-cabecera">
        <Mascota mini />
        <div>
          <p className="hoy-saludo">{saludo()}</p>
          <h1>Tu día</h1>
          <p className="nota hoy-fecha">{new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        </div>
      </header>
      <div className="hoy-resumen">
        <button className="hoy-cifra" onClick={() => irA('repaso')} disabled={!hoy.repasos}>
          <strong>{hoy.repasos}</strong>
          <span>{hoy.repasos === 1 ? 'repaso' : 'repasos'}</span>
          <small>
            {hoy.repasos
              ? `${hoy.nuevos ? `${hoy.nuevos} ${hoy.nuevos === 1 ? 'concepto nuevo' : 'conceptos nuevos'} · ` : ''}unos ${minutosRepaso ?? '·'} min · Repasar →`
              : 'nada pendiente'}
          </small>
        </button>
        {semana && (
          <div className="hoy-cifra">
            <strong>
              {String(Math.round(semana.hechas * 10) / 10).replace('.', ',')} <small>de {String(Math.round(semana.total * 10) / 10).replace('.', ',')} h</small>
            </strong>
            <span>esta semana</span>
            <span className="barra">
              <span style={{ width: `${semana.total ? (semana.hechas / semana.total) * 100 : 0}%` }} />
            </span>
            <small>
              {semana.hechasN} de {semana.sesiones} sesiones
            </small>
          </div>
        )}
        <button className="hoy-cifra" onClick={() => irA('examen')}>
          <strong>{hoy.examen ? '1' : '0'}</strong>
          <span>{hoy.examen ? 'examen pendiente' : 'exámenes pendientes'}</span>
          <small>{hoy.examen ? `${hoy.examen.titulo} →` : 'Hacer uno cuando quieras →'}</small>
        </button>
      </div>
      <TuDia hoy={hoy} minutosRepaso={minutosRepaso} irA={irA} />
      {hoy.examen && !examenDespues.length && <TarjetaExamen examen={hoy.examen} />}
      {hoy.titulo && hoy.estado !== 'solo_repaso' ? (
        <section className="tutor-hoy">
          <span className="vacio-etq">Hoy · {hoy.razon}</span>
          <h1>
            <span className="bloques-clave">{hoy.leccion_clave}</span> {tituloSencillo(indiceHoy, hoy.leccion_clave ?? '', hoy.titulo)}
          </h1>
          <p className="nota">
            {hoy.tema} · {String(hoy.horas).replace('.', ',')} h previstas
          </p>
          {hoy.estado === 'sin_preparar' || !hoy.material_id ? (
            <>
              <p>La lección aún no está preparada. Prepárala y vuelve: tarda unos minutos.</p>
              <div className="vacio-acciones">
                <button
                  className="boton boton-principal"
                  onClick={() => (hoy.tema_id ? irARuta(`#/fichas/${hoy.tema_id}/${hoy.leccion_clave}`) : irA('fichas'))}
                >
                  Prepararla
                </button>
              </div>
            </>
          ) : (
            <>
              <ul className="tutor-como">
                <li>Pantalla completa, sin menús ni avisos, con lupa y los colores que quieras.</li>
                <li>Una idea cada vez y una comprobación al final de cada una.</li>
                <li>Reloj con pausa cada 25 minutos. Esc para salir; guarda dónde lo dejas.</li>
              </ul>
              <div className="vacio-acciones">
                <button className="boton boton-principal" onClick={() => empezar(hoy.material_id!)}>
                  {seguir ?? 'Empezar en modo foco'}
                </button>
                {seguir && (
                  <button className="boton" onClick={() => empezar(hoy.material_id!, true)}>
                    Empezar de cero
                  </button>
                )}
                <button className="boton" onClick={() => irARuta(`#/llamada/clase/${hoy.leccion_clave}`)} title="Te la explica en voz y le interrumpes con tus dudas">
                  Explícamela por llamada
                </button>
                {hoy.repasos > 0 && (
                  <button className="boton" onClick={() => irA('repaso')}>
                    Antes, {hoy.repasos} repasos
                  </button>
                )}
              </div>
            </>
          )}
        </section>
      ) : (
        <Vacio
          etiqueta="Hoy"
          titulo={hoy.repasos ? 'Hoy toca repasar' : 'Hoy no te toca ninguna lección'}
          texto={
            hoy.repasos
              ? `No hay lección prevista, pero ${hoy.repasos} conceptos esperan su repaso. También puedes estudiar cualquier lección de abajo.`
              : 'Puedes estudiar cualquier lección preparada en modo foco, o descansar.'
          }
          acciones={hoy.repasos ? [{ texto: 'Repasar', principal: true, alPulsar: () => irA('repaso') }] : []}
        />
      )}
      {hoy.examen && examenDespues.length > 0 && <TarjetaExamen examen={hoy.examen} despues={examenDespues} />}
      {otras.some((o) => o.material_id && o.material_id !== hoy.material_id) && (
        <p className="tutor-otras-enlace">
          <button className="boton" onClick={() => irA('foco')}>
            Estudiar otra lección en modo foco →
          </button>
        </p>
      )}
    </div>
  )
}

// El modo foco con su propia entrada: la de hoy arriba y, debajo, todas las lecciones por temas.
function ElegirFoco({ hoy, otras, empezar }: { hoy: Hoy; otras: Opcion[]; empezar: (mid: number, desdeCero?: boolean) => void }) {
  const planId = otras[0]?.plan_id ?? hoy.plan_id
  const ix = usarIndice(planId)
  const deHoy = hoy.material_id && hoy.estado !== 'sin_preparar' && hoy.estado !== 'solo_repaso' ? otras.find((o) => o.material_id === hoy.material_id) : undefined
  const avanceHoy = deHoy?.material_id ? leerAvance(deHoy.material_id) : null
  // Agrupadas por los temas del índice sencillo; si aún no hay índice, en una sola lista.
  const grupos: { nombre: string; lecciones: Opcion[] }[] = ix
    ? ix.temas.map((t) => ({ nombre: t.nombre, lecciones: otras.filter((o) => o.plan_id === planId && t.lecciones.includes(o.clave)) }))
    : [{ nombre: '', lecciones: otras }]
  const sueltas = ix ? otras.filter((o) => !grupos.some((g) => g.lecciones.includes(o))) : []
  if (sueltas.length) grupos.push({ nombre: 'Otras', lecciones: sueltas })
  if (!otras.length)
    return (
      <div className="panel">
        <Vacio
          etiqueta="Modo foco"
          titulo="Aún no hay lecciones"
          texto="Crea tu plan y prepara una lección: aquí la estudiarás a pantalla completa, idea a idea, con una comprobación al final de cada una."
          acciones={[{ texto: 'Crear mi plan', principal: true, alPulsar: () => irARuta('#/nuevo-plan') }]}
        />
      </div>
    )
  return (
    <div className="tutor-inicio foco-elegir">
      <header>
        <h1>Modo foco</h1>
        <p className="nota">Pantalla completa, una idea cada vez y una comprobación al final de cada una. Esc para salir; guarda dónde lo dejas.</p>
      </header>
      {deHoy?.material_id && (
        <section className="tutor-hoy">
          <span className="vacio-etq">La de hoy</span>
          <h1>
            <span className="bloques-clave">{deHoy.clave}</span> {tituloSencillo(ix, deHoy.clave, deHoy.titulo)}
          </h1>
          <div className="vacio-acciones">
            <button className="boton boton-principal" onClick={() => empezar(deHoy.material_id!)}>
              {avanceHoy ? `Seguir por la idea ${avanceHoy.i + 1}` : 'Empezar'}
            </button>
            {avanceHoy && (
              <button className="boton" onClick={() => empezar(deHoy.material_id!, true)}>
                Empezar de cero
              </button>
            )}
          </div>
        </section>
      )}
      {grupos
        .filter((g) => g.lecciones.length)
        .map((g) => (
          <section key={g.nombre} className="tutor-otras">
            {g.nombre && <h2>{g.nombre}</h2>}
            <ul>
              {g.lecciones.map((o) => {
                const av = o.material_id ? leerAvance(o.material_id) : null
                return (
                  <li key={`${o.plan_id}-${o.clave}`}>
                    <button
                      className={`tutor-otra ${o.material_id ? '' : 'sin-preparar'}`}
                      onClick={() => (o.material_id ? empezar(o.material_id) : irARuta(`#/fichas/${o.tema_id}/${o.clave}`))}
                      title={o.material_id ? o.titulo : 'Aún sin preparar: te llevo a prepararla'}
                    >
                      <span className="bloques-clave">{o.clave}</span>
                      <span>{tituloSencillo(ix, o.clave, o.titulo)}</span>
                      <small>{!o.material_id ? 'Prepararla →' : av ? `a medias · idea ${av.i + 1}` : 'Empezar →'}</small>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
    </div>
  )
}
