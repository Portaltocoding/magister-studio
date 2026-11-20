import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as EventoPuntero } from 'react'
import { t } from '../i18n/i18n.ts'
import { tituloSencillo, usarIndice } from '../componentes/indice.tsx'
import Volcado from '../componentes/Volcado.tsx'
import Companera from '../componentes/Companera.tsx'
import MapaConceptos, { usarMapa } from '../componentes/MapaConceptos.tsx'
import Calentamiento, { ApuestasRevisadas, guardarCalentamiento, leerCalentamiento, type Apuestas, type DatosCalentamiento } from '../componentes/Calentamiento.tsx'
import Markdown from '../componentes/Markdown.tsx'
import {
  EVENTO_CAMBIO_APLICADO,
  ErrorApi,
  enviarJson,
  flujo,
  hoyIso,
  listarConversaciones,
  listarMensajes,
  listarPlanes,
  marcarSesion,
  pedir,
  rutaExamen,
  verPlan,
  type HitoExamen,
  type ResumenPlan,
} from '../api.ts'
import { colorDeTema, nombreCorto } from '../componentes/colorTema.ts'
import { Tex, TextoLibro } from '../componentes/LectorLibro.tsx'
import { varianteFicha } from '../componentes/varianteFicha.ts'
import { semanaDeTodos } from '../componentes/semana.ts'
import { numero, pluralT } from '../componentes/formato.ts'
import { idiomaActual } from '../i18n/i18n.ts'
import { usarIdioma } from '../i18n/usarIdioma.ts'
import MarcoFoco, { pedirPantallaCompleta, reloj } from '../componentes/MarcoFoco.tsx'
import Vacio, { irARuta } from '../componentes/Vacio.tsx'
import Mascota from '../Mascota.tsx'
import Cargando, { mensajeDe, TextoError } from '../componentes/Cargando.tsx'
import type { IdModo } from '../modos.ts'
import { aCss } from '../componentes/escala.ts'
import { AVISO_DICTADO, enVivo, leerPermisoDictado, olvidarPermisoDictado, unirDictado, usarDictado } from '../componentes/dictado.ts'
import { debeIgnorar, desplazarA, usarParrafoActivo, type Pantalla } from '../componentes/parrafos.ts'
import { guardarZen, leerZen, PIE_ASOMA_MS, pieVisible, progresoLeccion } from '../componentes/zen.ts'
import { usarPomodoro } from '../componentes/pomodoro.ts'
import { crearPomodoro, mmssDe, relojParado, textoReloj } from '../componentes/relojFoco.ts'
import { usarLeerEnVoz } from '../componentes/usarLeerEnVoz.ts'
import NotasFoco from '../componentes/NotasFoco.tsx'
import {
  alternarDuda,
  claveNota,
  dudasDeOtroDia,
  guardarDudas,
  guardarNotas,
  inicio40,
  leerDudas,
  leerNotas,
  localizar,
  loQueFlojeo,
  MAX_PARRAFO,
  ponerNota,
  quitarDuda,
  sinExplicar,
  textoAvisoDudas,
  type Duda,
  type Flojo,
  type Nota,
} from '../componentes/dudas.ts'
import {
  aMedias,
  claveListo,
  descartar,
  fotoAlLlegar,
  leerAvancesFoco,
  leerDescartados,
  leerPractica,
  nuevosListos,
  type AMedias,
  type MaterialListo,
  type UltimaConversacion,
} from '../componentes/aMedias.ts'
import {
  aplicarIdea,
  esRutaLeccion,
  leerRutaFoco,
  leerRutaRecordada,
  olvidarRutaRecordada,
  rutaDeVuelta,
  rutaFoco,
  textoSeguir,
  volverA,
} from '../componentes/retomar.ts'

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
  // tipo: «hablada», «conceptual»… (las habladas se pueden dictar).
  pregunta: { pregunta_id: string; enunciado: string; concepto_id: string; tipo?: string | null } | null
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
  // El párrafo activo de la idea i.
  u?: number
  // Lo que llevabas escrito en cada comprobación, por idea.
  borradores?: Record<string, Borrador>
  // Las preguntas ya servidas (se avisa al servidor una sola vez por pregunta).
  servidas?: string[]
  // Cuántas ideas tiene y cuándo se guardó: para «Lo dejaste ayer en la idea 3 de 5» en Hoy.
  n?: number
  en?: number
}

interface Borrador {
  respuesta: string
  confianza: number | null
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

// El ancho de la página del foco, en caracteres (ch de la letra del papel): lo eliges en Ajustes o arrastrando su
// borde derecho. Una medida de 64 se lee cómoda.
const ANCHOS: [number, string][] = [
  [56, 'Estrecha'],
  [64, 'Normal'],
  [72, 'Ancha'],
]
const ANCHO_NORMAL = 64
const ANCHO_MIN = 40
const ANCHO_MAX = 120
function leerAncho(): number {
  try {
    const n = Number(localStorage.getItem('magister-ancho-papel'))
    // Antes se guardaba en píxeles (780, 1000…): eso vuelve a la normal.
    return n >= ANCHO_MIN && n <= ANCHO_MAX ? n : ANCHO_NORMAL
  } catch {
    return ANCHO_NORMAL
  }
}
// Cuánto mide un ch en pantalla, con la letra del papel.
function medirCh(dentro: HTMLElement): number {
  const s = document.createElement('span')
  s.style.cssText = 'position:absolute;visibility:hidden;width:1ch;height:0'
  dentro.appendChild(s)
  const w = s.getBoundingClientRect().width
  s.remove()
  return w || 10
}

// La letra del papel: S, M o L.
const LETRAS: [string, string][] = [
  ['1.0625rem', 'S'],
  ['1.1875rem', 'M'],
  ['1.3125rem', 'L'],
]
function leerLetra(): string {
  try {
    const v = localStorage.getItem('magister-foco-letra')
    return LETRAS.some(([x]) => x === v) ? (v as string) : '1.1875rem'
  } catch {
    return '1.1875rem'
  }
}
function guardarLetra(v: string) {
  try {
    localStorage.setItem('magister-foco-letra', v)
  } catch {
    /* sin almacenamiento */
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
    const ch = papel ? medirCh(papel) : 10
    // Si el ancho guardado es mayor que el sitio que hay, se parte del real.
    const real = papel ? papel.getBoundingClientRect().width / ch : ancho
    const desde = Math.min(ancho, real)
    const asa = e.currentTarget
    asa.setPointerCapture(e.pointerId)
    document.body.classList.add('redimensionando')
    // La página va centrada: al mover un borde, crecen los dos; por eso el doble.
    const mover = (ev: PointerEvent) => alCambiar(Math.max(ANCHO_MIN, Math.min(ANCHO_MAX, Math.round(desde + ((ev.clientX - x0) * 2) / ch))))
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
      onDoubleClick={() => alCambiar(ANCHO_NORMAL)}
      onKeyDown={(e) => {
        // Sus flechas son suyas: no cambian de idea.
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') e.preventDefault()
        if (e.key === 'ArrowLeft') alCambiar(Math.max(ANCHO_MIN, ancho - 2))
        if (e.key === 'ArrowRight') alCambiar(Math.min(ANCHO_MAX, ancho + 2))
      }}
    />
  )
}

const almacenLocal = () => (typeof localStorage === 'undefined' ? null : localStorage)

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

// Una comprobación al final de cada idea: respondes de memoria y el tutor corrige. Lo escrito lo guarda la lección
// (no se pierde al cambiar de idea) y la pregunta se sirve desde la lección, una sola vez.
function Comprobar({
  pregunta,
  valor: respuesta,
  confianza,
  alCambiar,
  alAcabar,
  dictar = 0,
}: {
  pregunta: NonNullable<Bloque['pregunta']>
  valor: string
  confianza: number | null
  alCambiar: (b: Borrador) => void
  alAcabar: (nota: string) => void
  // Sube con la tecla D (fuera de la caja): dictar o dejar de dictar, en las habladas.
  dictar?: number
}) {
  const [nota, setNota] = useState<string | null>(null)
  const [explicacion, setExplicacion] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [inicio] = useState(() => Date.now())
  const chips = useRef<HTMLDivElement | null>(null)
  const setRespuesta = (r: string) => alCambiar({ respuesta: r, confianza })
  const setConfianza = (c: number) => alCambiar({ respuesta, confianza: c })
  const puedeEnviar = !enviando && !!respuesta.trim() && confianza != null

  // Las habladas («explícalo en voz alta») se contestan hablando: lo dictado va llenando la caja y se corrige igual.
  const ultimo = useRef({ respuesta, confianza, alCambiar })
  ultimo.current = { respuesta, confianza, alCambiar }
  const dictado = usarDictado((t) => {
    const u = ultimo.current
    const r = unirDictado(u.respuesta, t)
    ultimo.current = { ...u, respuesta: r }
    u.alCambiar({ respuesta: r, confianza: u.confianza })
  })
  const hablada = pregunta.tipo === 'hablada' && dictado.disponible
  const botonDictar = useRef<HTMLButtonElement | null>(null)
  const dictarVisto = useRef(dictar)
  useEffect(() => {
    if (dictar === dictarVisto.current) return
    dictarVisto.current = dictar
    if (!hablada || nota || enviando) return
    botonDictar.current?.focus({ preventScroll: true })
    dictado.alternar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dictar])

  // Si el corrector falla, no se inventa un «Fallada»: se dice y puedes volver a comprobar.
  const enviar = async () => {
    dictado.parar()
    setEnviando(true)
    setError(null)
    let final: string | null = null
    try {
      for await (const ev of flujo<{ tipo: string; nota?: string; t?: string; detalle?: string }>('/api/practica/intentos', {
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
        else if (ev.tipo === 'error') setError(ev.detalle || 'No se pudo corregir.')
      }
    } catch (e) {
      setError(mensajeDe(e))
    } finally {
      setEnviando(false)
    }
    if (final) alAcabar(final)
  }

  return (
    <div className="foco-comprobar">
      <div className="foco-comprobar-cabeza">
        <span className="foco-etq">Comprueba que lo tienes</span>
        {hablada && !nota && (
          <>
            <span className={`foco-escuchando ${dictado.escuchando ? 'si' : ''}`} aria-live="polite">
              {dictado.escuchando && (
                <>
                  <i aria-hidden="true" />
                  Escuchando en español…
                </>
              )}
            </span>
            <button
              ref={botonDictar}
              type="button"
              className="foco-boton foco-dictar"
              aria-pressed={dictado.escuchando}
              disabled={enviando}
              onClick={dictado.alternar}
              title="Dictar la respuesta en voz alta (D)"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <rect x="5" y="1" width="6" height="9" rx="3" fill="currentColor" />
                <path d="M3 7a5 5 0 0 0 10 0M8 12v3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
              </svg>
              {dictado.escuchando ? 'Parar (D)' : 'Dictar (D)'}
            </button>
          </>
        )}
      </div>
      <div className="foco-pregunta">
        <Markdown>{pregunta.enunciado}</Markdown>
      </div>
      {hablada && dictado.preguntando && (
        <div className="foco-dictado-aviso" role="group" aria-label="Permiso para dictar">
          <span>{AVISO_DICTADO} ¿Lo activo?</span>
          <button type="button" className="boton boton-principal" onClick={() => dictado.responder(true)} autoFocus>
            Sí, dictar
          </button>
          <button type="button" className="boton" onClick={() => dictado.responder(false)}>
            No, escribo
          </button>
        </div>
      )}
      {hablada && dictado.error && <p className="foco-dictado-error" role="alert">{dictado.error}</p>}
      <textarea
        value={dictado.escuchando ? enVivo(respuesta, dictado.parcial) : respuesta}
        disabled={!!nota || enviando}
        readOnly={dictado.escuchando}
        onChange={(e) => setRespuesta(e.target.value)}
        onKeyDown={(e) => {
          // Ctrl (o Cmd) + Intro: enviar; si falta decir cómo de seguro estás, al primer botón.
          if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey)) return
          e.preventDefault()
          if (puedeEnviar) enviar()
          else if (confianza == null) chips.current?.querySelector<HTMLElement>('[role="radio"]')?.focus()
        }}
        placeholder={hablada ? 'Pulsa «Dictar» (D) y explícalo en voz alta, o escríbelo' : 'Con tus palabras, sin mirar arriba'}
        aria-label="Tu respuesta"
      />
      {!nota && (
        <div className="foco-confianza">
          <span id="foco-confianza-etq">¿Cómo de seguro estás?</span>
          <div
            className="foco-confianza-chips"
            role="radiogroup"
            aria-labelledby="foco-confianza-etq"
            ref={chips}
            onKeyDown={(e) => {
              const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
              if (!d) return
              e.preventDefault()
              const k = CONFIANZAS.findIndex(([v]) => v === confianza)
              const n = k < 0 ? (d > 0 ? 0 : CONFIANZAS.length - 1) : (k + d + CONFIANZAS.length) % CONFIANZAS.length
              setConfianza(CONFIANZAS[n][0])
              chips.current?.querySelectorAll<HTMLElement>('[role="radio"]')[n]?.focus()
            }}
          >
            {CONFIANZAS.map(([v, t], k) => (
              <button
                key={v}
                role="radio"
                aria-checked={confianza === v}
                tabIndex={confianza === v || (confianza == null && k === 0) ? 0 : -1}
                className="opcion opcion-chip"
                data-elegida={confianza === v}
                onClick={() => setConfianza(v)}
              >
                {t}
              </button>
            ))}
          </div>
          <button className="boton boton-principal" disabled={!puedeEnviar} onClick={enviar}>
            {enviando ? 'Corrigiendo…' : 'Comprobar'}
          </button>
        </div>
      )}
      {error && <TextoError texto={error} antes="No he podido corregirla: " />}
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

// Pantallas estrechas: la mascota baja al pie y su bocadillo sale desde abajo.
function usarEstrecho(): boolean {
  const consulta = '(max-width: 1000px)'
  const [estrecho, setEstrecho] = useState(() => window.matchMedia?.(consulta).matches ?? false)
  useEffect(() => {
    const m = window.matchMedia?.(consulta)
    if (!m) return
    const cambio = () => setEstrecho(m.matches)
    m.addEventListener('change', cambio)
    return () => m.removeEventListener('change', cambio)
  }, [])
  return estrecho
}

const SALIDA_MS = 160
// Lo que dura el «Seguías aquí» al retomar.
const SEGUIAS_MS = 4000

// Una lección en modo foco: una idea cada vez, con su comprobación.
export function FocoLeccion({ leccion, sesionId, horas, repasos, inicial, alSalir, irA }: PropsFoco) {
  const { bloques } = leccion
  const mid = leccion.material_id
  const [i, setI] = useState(inicial?.i ?? 0)
  const [comprobado, setComprobado] = useState<Record<string, string>>(inicial?.comprobado ?? {})
  const [borradores, setBorradores] = useState<Record<string, Borrador>>(inicial?.borradores ?? {})
  const [servidas, setServidas] = useState<string[]>(inicial?.servidas ?? [])
  const servidasYa = useRef(new Set(inicial?.servidas ?? []))
  const [saliendo, setSaliendo] = useState(false)
  const [chuleta, setChuleta] = useState(false)
  const [errorCierre, setErrorCierre] = useState<string | null>(null)
  const [letra, setLetra] = useState(leerLetra)
  const [cuerpo, setCuerpo] = useState<HTMLDivElement | null>(null)
  const [abrirAyuda, setAbrirAyuda] = useState(0)
  const [dictar, setDictar] = useState(0)
  // Para volver a pintar los ajustes al quitar el permiso de dictado.
  const [, setPermisoQuitado] = useState(0)
  // «No lo entiendo» (N): las dudas y lo que te explicó la mascota de cada párrafo, guardados por lección.
  const [dudas, setDudas] = useState<Duda[]>(() => leerDudas(almacenLocal(), leccion.material_id))
  const [notas, setNotas] = useState<Nota[]>(() => leerNotas(almacenLocal(), leccion.material_id))
  const [notasAbiertas, setNotasAbiertas] = useState<Set<string>>(() => new Set())
  const [explicando, setExplicando] = useState<string | null>(null)
  const [errorExplicar, setErrorExplicar] = useState<string | null>(null)
  // El aviso de antes de la comprobación, ya contestado («No, sigo») en estas ideas.
  const [avisoDudasVisto, setAvisoDudasVisto] = useState<Set<string>>(() => new Set())
  // Al volver otro día con dudas, lo primero es «Te quedaron estas dudas».
  const [verDudas, setVerDudas] = useState(() => dudasDeOtroDia(leerDudas(almacenLocal(), leccion.material_id), Date.now()))
  // Lo que se anuncia al lector de pantalla (duda marcada, lectura en voz alta…).
  const [anuncio, setAnuncio] = useState('')
  const estrecho = usarEstrecho()
  const botonSeguir = useRef<HTMLButtonElement | null>(null)
  const [segundos, setSegundos] = useState(inicial?.segundos ?? 0)
  // Un solo reloj: el pomodoro (el Tomate) es el del foco. Su descanso abre la pantalla de descanso de aquí.
  // `pausado` solo cuenta sin pomodoro («sin pausa»).
  const pomo = usarPomodoro()
  const [pausado, setPausado] = useState(false)
  const enPausa = relojParado(pomo.p, pausado)
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
  // Modo zen (Z): se recuerda; por defecto, apagado.
  const [zen, setZen] = useState(() => leerZen(typeof localStorage === 'undefined' ? null : localStorage))
  const cambiarZen = useCallback((v?: boolean) => {
    setZen((z) => {
      const n = v ?? !z
      guardarZen(typeof localStorage === 'undefined' ? null : localStorage, n)
      return n
    })
  }, [])
  // En zen, el pie asoma un momento al cambiar de idea.
  const [pieAsoma, setPieAsoma] = useState(false)
  // Abrir el mapa no gasta nada: hacerlo leyendo la página es un botón dentro.
  const { mapa, cambiar: cambiarMapa, anadir: anadirAlMapa, generar: generarMapa, generando: generandoMapa, errorMapa } = usarMapa(mid)
  const [papel, setPapel] = useState<HTMLDivElement | null>(null)
  const [seleccion, setSeleccion] = useState<{ texto: string; x: number; y: number } | null>(null)
  const ideasDesdeReexplicar = useRef(0)
  const indiceFoco = usarIndice(leccion.plan_id)
  const tituloFoco = tituloSencillo(indiceFoco, leccion.leccion_clave, leccion.titulo)

  const b = bloques[i]
  const ultimo = i === bloques.length - 1
  const puedeSeguir = !b.pregunta || !!comprobado[b.clave]
  const pendiente = !!b.pregunta && !comprobado[b.clave]
  const hayGlosario = leccion.definiciones.length + leccion.formulas.length > 0
  // El descanso es el del pomodoro. Reexplicar va por encima: al cerrarlo, si el descanso sigue, vuelves a él.
  const descanso = pomo.p.fase === 'descanso' && !cerrada
  const pantalla: Pantalla =
    reexplicando && leccion.plan_id != null
      ? 'reexplicar'
      : descanso
        ? 'descanso'
        : verDudas && dudas.length > 0 && !cerrada
          ? 'dudas'
          : calentando && leccion.calentamiento
            ? 'calentamiento'
            : cerrada
              ? 'cierre'
              : 'idea'

  // Al cambiar de idea (o de pantalla), la zona vuelve arriba; el párrafo activo coloca después el suyo.
  useLayoutEffect(() => {
    if (cuerpo) desplazarA(cuerpo, 0, 0)
  }, [i, cerrada, cuerpo])

  // El párrafo activo: ↑ ↓ (y j k, Espacio) van de uno en uno; al volver, se sigue por el que dejaste.
  const uInicial = useRef(inicial?.i === i ? (inicial?.u ?? null) : null)
  // Mientras lee en voz alta, el ratón quieto encima no cambia el párrafo.
  const [leyendoVoz, setLeyendoVoz] = useState(false)
  const { u, unidades: lista, mover, ir: irUnidad, marca, ultimoScroll } = usarParrafoActivo(papel, cuerpo, b.clave, uInicial.current, leyendoVoz)
  useEffect(() => {
    if (lista.length) uInicial.current = null
  }, [lista])

  // Leer en voz alta (P): el párrafo activo y los siguientes, con la voz de Magister (Piper). Se para al llegar a la
  // comprobación, que se señala.
  const lectura = usarLeerEnVoz({
    lista,
    u,
    mover,
    clave: b.clave,
    activa: pantalla === 'idea' && !saliendo,
    alFinal: () => {
      if (!pendiente) return 'Fin de la idea'
      reclamarRef.current(false)
      return 'Me paro aquí: toca la comprobación'
    },
  })
  useEffect(() => setLeyendoVoz(lectura.leyendo), [lectura.leyendo])
  useEffect(() => {
    if (lectura.estado) setAnuncio(lectura.estado)
  }, [lectura.estado])
  const reclamarRef = useRef<(enfocar?: boolean) => void>(() => undefined)

  // ----- Dudas («No lo entiendo») -----
  useEffect(() => guardarDudas(almacenLocal(), mid, dudas), [mid, dudas])
  useEffect(() => guardarNotas(almacenLocal(), mid, notas), [mid, notas])
  const textoUnidad = (el: HTMLElement) => (el.innerText || el.textContent || '').trim()
  const textosIdea = () => lista.map(textoUnidad)
  const dudasIdea = dudas.filter((d) => d.clave === b.clave)
  const esDudaActiva = !!lista[u] && dudasIdea.some((d) => localizar(textosIdea(), d.u, d.texto) === u)
  const alternarDudaActiva = useCallback(() => {
    const el = lista[u]
    if (!el) return
    const t = textoUnidad(el)
    const d: Duda = { clave: b.clave, u, texto: inicio40(t), parrafo: t.slice(0, MAX_PARRAFO), en: Date.now() }
    const n = alternarDuda(dudas, d)
    setDudas(n)
    setAnuncio(n.length > dudas.length ? `Párrafo ${u + 1} marcado como duda.` : `Párrafo ${u + 1}: duda quitada.`)
  }, [lista, u, b.clave, dudas])
  // Ir a un párrafo de otra idea (o de esta): la idea cambia y el párrafo activo empieza en él.
  const irAParrafo = (idea: number, parrafo: number) => {
    setCerrada(false)
    setVerDudas(false)
    if (idea === i && lista.length) irUnidad(parrafo)
    else {
      uInicial.current = parrafo
      setI(idea)
    }
  }
  // «Explícame»: lo único que llama al modelo. Una llamada corta por duda, la misma de la mascota (tecla A).
  const explicar = async (cuales: Duda[]) => {
    if (!cuales.length || explicando) return
    setErrorExplicar(null)
    for (const [k, d] of cuales.entries()) {
      setExplicando(cuales.length > 1 ? `Explicando ${k + 1} de ${cuales.length}…` : 'Explicando…')
      try {
        const r = await pedir<{ texto: string }>(`/api/estudio/${mid}/parrafo`, enviarJson({ clave: d.clave, parrafo: d.parrafo, accion: 'facil', pregunta: null }))
        const n: Nota = { clave: d.clave, u: d.u, texto: d.texto, respuesta: r.texto, accion: 'facil', en: Date.now() }
        setNotas((ns) => ponerNota(ns, n))
        setNotasAbiertas((s) => new Set(s).add(claveNota(n)))
      } catch (e) {
        setErrorExplicar(`No he podido explicártelo: ${mensajeDe(e)}`)
        break
      }
    }
    setExplicando(null)
  }
  // Lo que la mascota explica de un párrafo se queda guardado debajo de él.
  const guardarRespuesta = (el: HTMLElement, accion: string, respuesta: string) => {
    const k = lista.indexOf(el)
    if (k < 0) return
    const n: Nota = { clave: b.clave, u: k, texto: inicio40(textoUnidad(el)), respuesta, accion, en: Date.now() }
    setNotas((ns) => ponerNota(ns, n))
    setNotasAbiertas((s) => new Set(s).add(claveNota(n)))
  }
  const notaDe = (d: Duda) => notas.find((n) => n.clave === d.clave && n.texto === d.texto)

  // La ruta, mientras la lección está abierta: #/foco/<apuntes>/<idea> (recargar te deja aquí). La historia guarda
  // a dónde volver; al salir con «Salir» o Esc, vuelves allí (Hoy, la lista, Lecciones…).
  const [desde] = useState(() =>
    rutaDeVuelta({ estado: window.history.state, recordada: leerRutaRecordada(Date.now()), actual: window.location.hash }),
  )
  useEffect(() => {
    olvidarRutaRecordada()
    return () => {
      // Si sales por otro camino (Repasar ahora, Examinarme…), la ruta de la lección no se queda puesta.
      if (esRutaLeccion(window.location.hash)) window.history.replaceState(null, '', desde)
    }
  }, [desde])
  useEffect(() => {
    window.history.replaceState({ ...(window.history.state ?? {}), desde }, '', rutaFoco(mid, i))
  }, [mid, i, desde])
  const salirFoco = useCallback(() => {
    alSalir()
    volverA(desde)
  }, [alSalir, desde])

  // «Seguías aquí»: al volver a una lección empezada, la marca se ilumina un momento en el párrafo donde ibas.
  const reanudada = useRef(!!inicial && (inicial.i > 0 || (inicial.u ?? 0) > 0))
  const [seguias, setSeguias] = useState(false)
  const tSeguias = useRef(0)
  useEffect(() => () => window.clearTimeout(tSeguias.current), [])
  useEffect(() => {
    if (!reanudada.current || pantalla !== 'idea' || !marca) return
    reanudada.current = false
    setSeguias(true)
    tSeguias.current = window.setTimeout(() => setSeguias(false), SEGUIAS_MS)
  }, [pantalla, marca])

  const ideaVista = useRef(i)
  useEffect(() => {
    if (ideaVista.current === i) return
    ideaVista.current = i
    if (!zen) return
    setPieAsoma(true)
    const t = window.setTimeout(() => setPieAsoma(false), PIE_ASOMA_MS)
    return () => {
      window.clearTimeout(t)
      setPieAsoma(false)
    }
  }, [i, zen])

  // Lo que llevas de estudio (para el cierre): solo cuenta con la pestaña a la vista, sin pausa y sin descanso.
  useEffect(() => {
    if (enPausa || descanso || cerrada) return
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') setSegundos((s) => s + 1)
    }, 1000)
    return () => clearInterval(t)
  }, [enPausa, descanso, cerrada])

  // Sin pomodoro en marcha, el ajuste «Pausa» crea uno (también al acabar un descanso). Al salir, sigue fuera.
  const { empezar: empezarPomodoro } = pomo
  useEffect(() => {
    if (crearPomodoro(pomo.p, ritmo.pausa, cerrada)) empezarPomodoro(ritmo.pausa, pomo.p.descanso)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pomo.p.fase, ritmo.pausa, cerrada])
  const volverDelDescanso = () => empezarPomodoro(ritmo.pausa > 0 ? ritmo.pausa : pomo.p.foco, pomo.p.descanso)
  const cambiarPausa = (min: number) => {
    const r = { ...ritmo, pausa: min }
    setRitmo(r)
    guardarRitmo(r)
    // El pomodoro que corre se rehace con la nueva medida (el descanso en curso, no); «sin pausa» lo para.
    if (min > 0 && pomo.p.fase !== 'descanso') empezarPomodoro(min, pomo.p.descanso)
    else if (min === 0 && pomo.p.fase === 'foco') pomo.parar()
  }
  const relojTexto = textoReloj({ p: pomo.p, quedan: pomo.quedan, segundos, zen })

  useEffect(() => {
    if (!cerrada) guardarAvance(mid, { i, comprobado, segundos, u, borradores, servidas, n: bloques.length, en: Date.now() })
  }, [mid, i, comprobado, segundos, cerrada, u, borradores, servidas, bloques.length])

  // La pregunta de la idea se sirve al verla, una sola vez aunque vuelvas a ella (p_predicha se apunta al servirla).
  useEffect(() => {
    const p = b.pregunta
    if (pantalla !== 'idea' || !p || comprobado[b.clave] || servidasYa.current.has(p.pregunta_id)) return
    servidasYa.current.add(p.pregunta_id)
    setServidas((s) => [...s, p.pregunta_id])
    pedir(`/api/tutor/servir/${p.pregunta_id}`, { method: 'POST' }).catch(() => undefined)
  }, [pantalla, b.clave, b.pregunta, comprobado])

  // Al acabar (o saltar) la comprobación, el foco va al botón de seguir.
  const notaVista = useRef<{ clave: string; nota?: string }>({ clave: b.clave, nota: comprobado[b.clave] })
  useEffect(() => {
    const nota = comprobado[b.clave]
    if (notaVista.current.clave === b.clave && nota && !notaVista.current.nota) botonSeguir.current?.focus()
    notaVista.current = { clave: b.clave, nota }
  }, [comprobado, b.clave])

  // Cambiar de idea: la que se va se funde (160 ms) y, ya sin verse, cambia el texto y la zona vuelve arriba.
  const destinoIdea = useRef<number | null>(null)
  const cambiarIdea = useCallback(
    (n: number) => {
      const k = Math.max(0, Math.min(bloques.length - 1, n))
      if (destinoIdea.current != null) {
        destinoIdea.current = k
        return
      }
      if (k === i) return
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        setI(k)
        return
      }
      destinoIdea.current = k
      setSaliendo(true)
      window.setTimeout(() => {
        const d = destinoIdea.current
        destinoIdea.current = null
        if (d != null) setI(d)
        setSaliendo(false)
      }, SALIDA_MS)
    },
    [bloques.length, i],
  )

  const ir = useCallback(
    (d: number) => {
      if (d > 0 && (!puedeSeguir || ultimo)) return
      if (d < 0 && i === 0) return
      if (d > 0 && leccion.plan_id != null && (ritmo.reexplicar === 'idea' || ritmo.reexplicar === 'dos')) {
        ideasDesdeReexplicar.current += 1
        if (ideasDesdeReexplicar.current >= (ritmo.reexplicar === 'idea' ? 1 : 2)) {
          ideasDesdeReexplicar.current = 0
          setReexplicando(true)
        }
      }
      cambiarIdea(i + d)
    },
    [puedeSeguir, ultimo, i, ritmo.reexplicar, leccion.plan_id, cambiarIdea],
  )

  // Con la comprobación pendiente, → (o ↓ en el último párrafo) te lleva a ella y la señala un momento.
  const reclamar = useCallback((enfocar = true) => {
    const caja = cuerpo?.querySelector<HTMLElement>('.foco-comprobar')
    if (!caja || !cuerpo) return
    const zona = cuerpo.getBoundingClientRect()
    const r = caja.getBoundingClientRect()
    const escala = cuerpo.offsetHeight ? zona.height / cuerpo.offsetHeight : 1
    desplazarA(cuerpo, cuerpo.scrollTop + (r.top - (zona.top + zona.height * 0.2)) / escala)
    if (enfocar) caja.querySelector('textarea')?.focus({ preventScroll: true })
    caja.classList.add('reclama')
    window.setTimeout(() => caja.classList.remove('reclama'), 1200)
  }, [cuerpo])
  reclamarRef.current = reclamar

  const teclas = useCallback(
    (e: KeyboardEvent, ctx: { menuAbierto: boolean }) => {
      // Esc cierra capa a capa: los atajos, «+ Al mapa», el mapa y el glosario. Sin nada abierto, sales.
      if (e.key === 'Escape') {
        if (chuleta) setChuleta(false)
        else if (lectura.leyendo) lectura.parar('Lectura parada')
        else if (seleccion) {
          setSeleccion(null)
          window.getSelection()?.removeAllRanges()
        } else if (verMapa) setVerMapa(false)
        else if (glosario) setGlosario(false)
        else if (zen) cambiarZen(false)
        else return false
        return true
      }
      // Z: modo zen, en cualquier pantalla de la lección (menos escribiendo).
      if ((e.key === 'z' || e.key === 'Z') && !debeIgnorar(e, { pantalla: 'idea', menuAbierto: false })) {
        e.preventDefault()
        cambiarZen()
        return true
      }
      if (cerrada || descanso || calentando || reexplicando) return false
      if (debeIgnorar(e, { pantalla, menuAbierto: ctx.menuAbierto })) return false
      const k = e.key
      if (k === 'ArrowDown' || k === 'j' || (k === ' ' && !e.shiftKey)) {
        if (!lista.length || u >= lista.length - 1) {
          if (pendiente) reclamar()
          else botonSeguir.current?.focus()
        } else mover(1)
      } else if (k === 'ArrowUp' || k === 'k' || (k === ' ' && e.shiftKey)) mover(-1)
      else if (k === 'Home') irUnidad(0)
      else if (k === 'End') irUnidad(lista.length - 1)
      else if (k === 'ArrowRight') {
        if (pendiente) reclamar()
        else ir(1)
      } else if (k === 'ArrowLeft') ir(-1)
      else if (k === 'g' && hayGlosario) setGlosario((g) => !g)
      else if (k === 'm') setVerMapa((v) => !v)
      else if (k === 'a') setAbrirAyuda((x) => x + 1)
      else if (k === 'n' || k === 'N') alternarDudaActiva()
      else if (k === 'p' || k === 'P') void lectura.alternar()
      else if ((k === 'd' || k === 'D') && pendiente && b.pregunta?.tipo === 'hablada') {
        // D: a la comprobación hablada y dictar (o dejar de dictar). El foco va al botón, no a la caja: otra D para.
        reclamar(false)
        setDictar((x) => x + 1)
      } else if (k === '?') setChuleta((c) => !c)
      else return false
      e.preventDefault()
      return true
    },
    [ir, glosario, cerrada, descanso, calentando, reexplicando, hayGlosario, chuleta, seleccion, verMapa, pantalla, lista, u, pendiente, reclamar, mover, irUnidad, zen, cambiarZen, b.pregunta, alternarDudaActiva, lectura],
  )

  const cerrar = async () => {
    // Has visto la lección entera: se marcan todas sus sesiones pendientes, no solo la de hoy (una lección partida
    // en dos días volvería a salir en «Hoy»). Solo si hoy ya marcaba algo, para no tocar lecciones abiertas por adelantado.
    setErrorCierre(null)
    if (sesionId) {
      try {
        if (leccion.plan_id != null)
          await pedir(`/api/planes/${leccion.plan_id}/lecciones/${encodeURIComponent(leccion.leccion_clave)}/hecha`, enviarJson({}, 'PATCH'))
        else await marcarSesion(sesionId, 'hecha')
      } catch (e) {
        // El avance no se borra hasta que salga bien.
        setErrorCierre(mensajeDe(e))
        return
      }
    }
    guardarAvance(mid, null)
    setCerrada(true)
  }

  const notasComprobadas = Object.values(comprobado)
  // Lo que vuelve en tu repaso: lo fallado y lo que salió a medias. Lo saltado no cuenta (no contestaste).
  const flojas = Object.entries(comprobado).filter(([, n]) => n === 'fallo' || n === 'parcial')
  const saltadas = Object.entries(comprobado).filter(([, n]) => n === 'saltada')
  // «Lo que flojeó»: las dudas por párrafo, lo fallado y lo que salió a medias; cada duda con su explicación, si la hay.
  const flojo = loQueFlojeo(bloques, comprobado, dudas)
  const porExplicar = sinExplicar(dudas, notas)
  const listaFlojo = (items: Flojo[]) => (
    <ul className="foco-flojeo-lista">
      {items.map((x) => {
        const d = x.tipo === 'duda' ? dudas.find((y) => y.clave === x.clave && y.u === x.u && y.texto === x.texto) : undefined
        const nota = d ? notaDe(d) : undefined
        return (
          <li key={`${x.tipo}-${x.clave}-${x.u ?? ''}`}>
            <span className={`chip ${x.tipo === 'duda' ? 'chip-duda' : `nota-${x.tipo}`}`}>{x.tipo === 'duda' ? 'Duda' : (NOTA[x.tipo] ?? x.tipo)}</span>
            <span className="foco-flojeo-texto">
              Idea {x.idea + 1}
              {x.u != null ? `, párrafo ${x.u + 1}` : ''}: {x.tipo === 'duda' ? `«${x.texto}…»` : x.titulo}
            </span>
            {d && (
              <button className="boton-mini" onClick={() => setDudas((ds) => quitarDuda(ds, d))} title="Quitar la duda">
                Ya lo entiendo
              </button>
            )}
            {nota && (
              <details className="foco-nota" open={notasAbiertas.has(claveNota(nota))}>
                <summary>La mascota te lo explicó así</summary>
                <p>{nota.respuesta.replace(/\*\*/g, '')}</p>
              </details>
            )}
          </li>
        )
      })}
    </ul>
  )
  const contestarSaltadas = () => {
    const claves = new Set(saltadas.map(([k]) => k))
    const n = bloques.findIndex((x) => claves.has(x.clave))
    setComprobado((c) => Object.fromEntries(Object.entries(c).filter(([, v]) => v !== 'saltada')))
    setCerrada(false)
    setI(Math.max(0, n))
  }
  const previsto = (horas ?? 0) * 3600

  return (
    <MarcoFoco
      titulo={tituloFoco}
      placa={leccion.leccion_clave}
      leccion={leccion.leccion_clave}
      alSalir={salirFoco}
      teclas={teclas}
      alCuerpo={setCuerpo}
      zen={zen}
      progreso={cerrada ? 1 : calentando ? 0 : progresoLeccion(i, bloques.length, u, lista.length)}
      pieVisible={pieVisible({
        zen,
        pantalla,
        ultimoParrafo: !lista.length || u >= lista.length - 1,
        asomando: pieAsoma,
        chuleta,
        error: !!errorCierre,
      })}
      pasos={
        <ol className="foco-pasos" aria-label="Ideas de la lección">
          {bloques.map((x, k) => (
            <li key={x.clave}>
              <button
                className={`foco-paso ${k === i && !cerrada ? 'actual' : ''} ${comprobado[x.clave] ? `nota-${comprobado[x.clave]}` : k < i || cerrada ? 'vista' : ''}`}
                title={`${k + 1}. ${x.titulo}`}
                aria-label={`Idea ${k + 1}: ${x.titulo}`}
                disabled={cerrada || calentando || reexplicando || (k > i && !bloques.slice(i, k).every((y) => !y.pregunta || comprobado[y.clave]))}
                onClick={() => cambiarIdea(k)}
              />
            </li>
          ))}
        </ol>
      }
      reloj={
        <button
          className={`foco-reloj ${enPausa ? 'pausado' : ''}`}
          onClick={() => (pomo.p.fase ? (enPausa ? pomo.seguir() : pomo.pausar()) : setPausado(!pausado))}
          title={
            pomo.p.fase
              ? `${enPausa ? 'Seguir' : 'Pausar'} el pomodoro (es el mismo que el Tomate de la barra)`
              : enPausa
                ? 'Seguir'
                : 'Pausar el reloj'
          }
        >
          {enPausa ? 'En pausa ▶' : '❚❚'} {relojTexto.tiempo}
          {!zen && relojTexto.fase && <small> · {relojTexto.fase}</small>}
          {!zen && !relojTexto.fase && previsto > 0 && <small> / {reloj(previsto)}</small>}
        </button>
      }
      herramientas={
        <>
          {hayGlosario && (
            <button className="foco-boton" aria-pressed={glosario} onClick={() => { setGlosario(!glosario); setVerMapa(false) }} title="Términos y fórmulas (G)">
              {leccion.formulas.length ? 'Términos y fórmulas' : 'Términos'}
            </button>
          )}
          {pantalla === 'idea' && (
            <button className="foco-boton" aria-pressed={lectura.leyendo} onClick={() => void lectura.alternar()} title="Leer en voz alta desde el párrafo activo, con la voz de Magister (P)">
              {lectura.leyendo ? 'Parar la lectura' : 'Leer en voz alta'}
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
      ajustes={
        <>
        <button className="foco-boton" aria-pressed={zen} onClick={() => cambiarZen()} title="Esconder la barra y el pie mientras lees (Z)">
          {zen ? '✓ ' : ''}Modo zen (Z)
        </button>
        {leerPermisoDictado(typeof localStorage === 'undefined' ? null : localStorage) === 'si' && (
          <button
            className="foco-boton"
            onClick={() => {
              olvidarPermisoDictado()
              setPermisoQuitado((x) => x + 1)
            }}
            title="El dictado usa el servicio de voz del navegador (en Chrome, los servidores de Google). Se volverá a preguntar."
          >
            Quitar el permiso de dictado
          </button>
        )}
        <span className="foco-ritmo-ajustes">
          <span className="foco-ancho">
            Ancho de la página
            <span className="foco-ancho-opciones">
              {ANCHOS.map(([n, t]) => (
                <button key={n} type="button" className="foco-boton" aria-pressed={Math.abs(ancho - n) < 4} onClick={() => cambiarAncho(n)}>
                  {t}
                </button>
              ))}
            </span>
            <small>También puedes arrastrar el borde derecho de la página.</small>
          </span>
          <span className="foco-ancho">
            Letra
            <span className="foco-ancho-opciones foco-letras">
              {LETRAS.map(([v, t]) => (
                <button key={v} type="button" className="foco-boton" aria-pressed={letra === v} onClick={() => { setLetra(v); guardarLetra(v) }}>
                  {t}
                </button>
              ))}
            </span>
          </span>
          <label title="El pomodoro del foco: es el mismo que el Tomate de la barra">
            Pausa
            <select value={ritmo.pausa} onChange={(e) => cambiarPausa(Number(e.target.value))}>
              {[15, 25, 40, 50].map((m) => (
                <option key={m} value={m}>
                  cada {m} min
                </option>
              ))}
              <option value={0}>sin pausa</option>
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
        </>
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
              {generandoMapa
                ? 'Leyendo la lección para sacar los conceptos clave y unirlos…'
                : 'Los conceptos clave de la lección y cómo se relacionan. Muévelos, quita o añade lo que quieras.'}
            </p>
            {errorMapa && <p className="nota">{errorMapa}</p>}
            <div className="mapa-barra">
              <button
                className="boton-mini"
                disabled={generandoMapa}
                onClick={() => {
                  if (mapa.nodos.length === 0 || window.confirm('Se rehace el mapa desde la lección y se pierden tus cambios. ¿Seguimos?')) generarMapa()
                }}
              >
                {generandoMapa ? 'Haciendo el mapa…' : mapa.nodos.length ? 'Rehacer desde la lección' : 'Hacerlo leyendo la página'}
              </button>
            </div>
            <MapaConceptos mapa={mapa} alCambiar={cambiarMapa} />
          </aside>
        ) : null
      }
      pie={
        pantalla === 'calentamiento' ? (
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
        !descanso &&
        pantalla !== 'dudas' && (
          <>
            <button className="boton" disabled={i === 0} onClick={() => ir(-1)}>
              ← Anterior
            </button>
            {errorCierre ? (
              <span className="foco-atajos foco-error-cierre" role="alert" title={errorCierre}>
                No he podido marcarla como hecha; tu avance sigue guardado.
              </span>
            ) : lectura.estado ? (
              <span className="foco-atajos foco-lectura-estado">
                {lectura.leyendo && <i className="foco-leyendo-punto" aria-hidden="true" />}
                {lectura.estado}
              </span>
            ) : (
              <span className="foco-atajos">
                {puedeSeguir ? '↑ ↓ párrafo · ← → idea · ? atajos · Esc salir' : 'Para seguir, contesta la comprobación del final de la idea (o sáltala).'}
              </span>
            )}
            {pantalla === 'idea' && lista.length > 0 && (
              <span className="foco-contador-parrafo">
                párrafo {u + 1} de {lista.length}
              </span>
            )}
            {chuleta && (
              <div className="foco-chuleta" role="dialog" aria-label="Atajos de teclado">
                <strong>Atajos</strong>
                <dl>
                  <dt>↓ · J · Espacio</dt>
                  <dd>Párrafo siguiente</dd>
                  <dt>↑ · K · Mayús + Espacio</dt>
                  <dd>Párrafo anterior</dd>
                  <dt>Inicio · Fin</dt>
                  <dd>Primer y último párrafo</dd>
                  <dt>← →</dt>
                  <dd>Idea anterior y siguiente</dd>
                  <dt>A</dt>
                  <dd>La mascota te ayuda con el párrafo</dd>
                  <dt>N</dt>
                  <dd>No lo entiendo: marcar el párrafo como duda</dd>
                  <dt>P</dt>
                  <dd>Leer en voz alta desde el párrafo (P o Esc para)</dd>
                  <dt>L</dt>
                  <dd>Atenuar lo demás</dd>
                  <dt>Z</dt>
                  <dd>Modo zen: solo la página</dd>
                  {b.pregunta?.tipo === 'hablada' && (
                    <>
                      <dt>D</dt>
                      <dd>Dictar la respuesta de la comprobación</dd>
                    </>
                  )}
                  {hayGlosario && (
                    <>
                      <dt>G</dt>
                      <dd>Términos</dd>
                    </>
                  )}
                  <dt>M</dt>
                  <dd>Tu mapa</dd>
                  <dt>?</dt>
                  <dd>Esta lista</dd>
                  <dt>Esc</dt>
                  <dd>Cerrar lo abierto, salir del zen o salir</dd>
                </dl>
              </div>
            )}
            {estrecho && pantalla === 'idea' && (
              <Companera
                key={b.clave}
                mid={mid}
                claveBloque={b.clave}
                parrafo={lista[u] ?? null}
                estrecho
                alPalabras={(ps) => anadirAlMapa(ps)}
                enMapa={mapa?.nodos.map((n) => n.texto) ?? []}
                abrir={abrirAyuda}
                desplazadoHace={() => Date.now() - ultimoScroll.current}
                esDuda={esDudaActiva}
                alDuda={alternarDudaActiva}
                alRespuesta={guardarRespuesta}
              />
            )}
            {pendiente && (
              <button className="boton-mini" onClick={() => setComprobado((c) => ({ ...c, [b.clave]: 'saltada' }))}>
                Saltar la comprobación
              </button>
            )}
            {errorCierre ? (
              <button ref={botonSeguir} className="boton boton-principal" onClick={cerrar}>
                Reintentar
              </button>
            ) : ultimo ? (
              <button ref={botonSeguir} className="boton boton-principal" disabled={!puedeSeguir} onClick={cerrar}>
                Cerrar la sesión
              </button>
            ) : (
              <button ref={botonSeguir} className="boton boton-principal" disabled={!puedeSeguir} onClick={() => ir(1)}>
                Siguiente idea →
              </button>
            )}
          </>
        )
      }
    >
      <div className="solo-lector" aria-live="polite">
        {pantalla === 'idea' ? `Idea ${i + 1} de ${bloques.length}: ${b.titulo}` : ''}
      </div>
      <div className="solo-lector" aria-live="polite">
        {anuncio}
      </div>
      {/* En zen, la barra y el pie están apartados: lo que hace la lectura va en una pastilla pequeña, solo mientras dura. */}
      {zen && lectura.estado && (
        <span className="foco-leyendo-pastilla" aria-hidden="true">
          {lectura.leyendo && <i className="foco-leyendo-punto" />}
          {lectura.estado}
        </span>
      )}
      {reexplicando && leccion.plan_id != null ? (
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
          // «Ahora no» (o acabar) solo cierra Reexplicar: si el pomodoro está en su descanso, se vuelve a él.
          alCerrar={() => setReexplicando(false)}
        />
      ) : descanso ? (
        <section className="foco-descanso">
          <span className="foco-etq">Descanso</span>
          <strong>{mmssDe(pomo.quedan ?? 0)}</strong>
          <p>
            Levántate, mira lejos, bebe agua. Nada de pantallas: el cerebro ordena lo que acabas de leer mientras no haces nada. Es el
            mismo pomodoro que llevas fuera del foco.
          </p>
          <div className="botones">
            {leccion.plan_id != null && ritmo.reexplicar === 'pausa' && (
              <button className="boton" onClick={() => setReexplicando(true)} title="Explícate sin mirar lo que llevas">
                Antes, reexplica lo que llevas
              </button>
            )}
            <button className="boton boton-principal" onClick={volverDelDescanso}>
              Seguir leyendo
            </button>
          </div>
        </section>
      ) : pantalla === 'dudas' ? (
        <section className="foco-cierre foco-dudas">
          <span className="foco-etq">Antes de seguir</span>
          <h1>Te quedaron estas dudas</h1>
          <div className="foco-flojeo">
            {listaFlojo(loQueFlojeo(bloques, {}, dudas))}
            <div className="botones">
              {porExplicar.length > 0 && (
                <button className="boton boton-principal" disabled={!!explicando} onClick={() => explicar(porExplicar)} title="Una explicación corta de cada duda (llama al modelo)">
                  {explicando ?? 'Explícamelas'}
                </button>
              )}
              <button className="boton" onClick={() => { const x = loQueFlojeo(bloques, {}, dudas)[0]; if (x) irAParrafo(x.idea, x.u ?? 0) }}>
                Ir a la primera
              </button>
              <button className="boton" onClick={() => setVerDudas(false)}>
                Seguir donde lo dejé
              </button>
            </div>
            {errorExplicar && <TextoError texto={errorExplicar} />}
          </div>
        </section>
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
                {notasComprobadas.filter((n) => n === 'bien' || n === 'perfecta').length} de {bloques.filter((x) => x.pregunta).length}
              </strong>
              <span>comprobaciones bien</span>
            </div>
          </div>
          {leccion.calentamiento && <ApuestasRevisadas previas={leccion.calentamiento.previas} apuestas={apuestas} />}
          {saltadas.length > 0 && (
            <>
              <p>No las contestaste (no cuentan para tu repaso):</p>
              <ul className="foco-flojas">
                {saltadas.map(([k, n]) => (
                  <li key={k}>
                    {bloques.find((x) => x.clave === k)?.titulo ?? k} <span className={`chip nota-${n}`}>{NOTA[n] ?? n}</span>
                  </li>
                ))}
              </ul>
              <div className="botones">
                <button className="boton" onClick={contestarSaltadas}>
                  Contestarlas ahora
                </button>
              </div>
            </>
          )}
          {flojo.length > 0 ? (
            <div className="foco-flojeo">
              <h2>Lo que flojeó</h2>
              {flojas.length > 0 && <p className="nota">Lo fallado y lo que salió a medias vuelve en tu repaso, antes que lo demás.</p>}
              {listaFlojo(flojo)}
              <div className="botones">
                {porExplicar.length > 0 && (
                  <button className="boton boton-principal" disabled={!!explicando} onClick={() => explicar(porExplicar)} title="Una explicación corta de cada duda (llama al modelo)">
                    {explicando ?? 'Explícame estas'}
                  </button>
                )}
                <button className="boton" onClick={() => irAParrafo(flojo[0].idea, flojo[0].u ?? 0)} title="Vuelve a la lección, a la primera">
                  Repasar estas
                </button>
              </div>
              {errorExplicar && <TextoError texto={errorExplicar} />}
            </div>
          ) : (
            !saltadas.length && <p>Todo bien. Los conceptos de hoy volverán en el repaso justo antes de que se te olviden.</p>
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
            <button className="boton" onClick={salirFoco}>
              Salir del foco
            </button>
          </div>
        </section>
      ) : (
        <article
          key={b.clave}
          className={`foco-idea foco-lectura foco-idea-entra ${saliendo ? 'saliendo' : ''}`}
          style={{ '--ancho-papel': `${ancho}ch`, '--foco-letra': letra } as CSSProperties}
        >
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
            <TextoLibro markdown={b.texto} className="foco-papel" variante={varianteFicha(leccion.leccion_clave, leccion.plan_id)} />
            {marca && <div className={`foco-marca ${seguias ? 'seguias' : ''}`} aria-hidden="true" style={{ top: marca.top, height: marca.height }} />}
            {marca && seguias && (
              <span className="foco-seguias" role="status" style={{ top: marca.top - 26 }}>
                Seguías aquí
              </span>
            )}
            <AsaAncho ancho={ancho} alCambiar={cambiarAncho} papel={papel} />
            {seleccion && (
              <button
                className="al-mapa"
                style={{ left: aCss(seleccion.x), top: aCss(seleccion.y) }}
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
            {!estrecho && (
              <Companera
                key={b.clave}
                mid={mid}
                claveBloque={b.clave}
                parrafo={lista[u] ?? null}
                estrecho={false}
                alPalabras={(ps) => anadirAlMapa(ps)}
                enMapa={mapa?.nodos.map((n) => n.texto) ?? []}
                abrir={abrirAyuda}
                desplazadoHace={() => Date.now() - ultimoScroll.current}
                esDuda={esDudaActiva}
                alDuda={alternarDudaActiva}
                alRespuesta={guardarRespuesta}
              />
            )}
            <NotasFoco lista={lista} clave={b.clave} dudas={dudas} notas={notas} abiertas={notasAbiertas} />
          </div>
          {pendiente && !avisoDudasVisto.has(b.clave) && sinExplicar(dudasIdea, notas).length > 0 && (
            <div className="foco-aviso-dudas" role="status">
              <span>{textoAvisoDudas(sinExplicar(dudasIdea, notas).length)}</span>
              <button className="boton boton-principal" disabled={!!explicando} onClick={() => explicar(sinExplicar(dudasIdea, notas))}>
                {explicando ?? 'Sí, explícamelo'}
              </button>
              <button className="boton" onClick={() => setAvisoDudasVisto((s) => new Set(s).add(b.clave))}>
                No, sigo
              </button>
              {errorExplicar && <TextoError texto={errorExplicar} />}
            </div>
          )}
          {b.pregunta && !comprobado[b.clave] && (
            <Comprobar
              key={b.clave}
              pregunta={b.pregunta}
              valor={borradores[b.clave]?.respuesta ?? ''}
              confianza={borradores[b.clave]?.confianza ?? null}
              dictar={dictar}
              alCambiar={(x) => setBorradores((bs) => ({ ...bs, [b.clave]: x }))}
              alAcabar={(n) => {
                setComprobado((c) => ({ ...c, [b.clave]: n }))
                setBorradores((bs) => Object.fromEntries(Object.entries(bs).filter(([k]) => k !== b.clave)))
              }}
            />
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
// «Hoy»: lo que toca, en orden (repasar, las lecciones, el examen al final) y cuánto queda.
function TuDia({ hoy, minutosRepaso, irA, planes = [] }: { hoy: Hoy; minutosRepaso: number | null; irA: (m: IdModo) => void; planes?: ResumenPlan[] }) {
  const dia = hoy.dia ?? []
  const indice = usarIndice(hoy.plan_id)
  // Si hoy toca más de un plan, cada sesión lleva el nombre y el color de su tema.
  const variosPlanes = new Set(dia.map((s) => s.plan_id).filter((p) => p != null)).size > 1
  const temaDeSesion = (planId?: number) => planes.find((p) => p.plan_id === planId)
  if (!dia.length && !hoy.examen && !hoy.temas?.length) return null
  const horas = (n: number) => numero(n, 1)
  const quedan = dia.filter((s) => s.estado !== 'hecha').reduce((a, s) => a + s.horas, 0) +
    (hoy.repasos ? (minutosRepaso ?? hoy.repasos * 2) / 60 : 0) + (hoy.examen && !hoy.examen.hecho ? hoy.examen.minutos / 60 : 0)
  let n = 0
  return (
    <section className="tu-dia">
      <h2>
        {t('hoy.loQueToca')} <small>{quedan > 0 ? t('hoy.quedan', { h: horas(quedan) }) : t('hoy.todoHecho')}</small>
      </h2>
      <ol>
        {(hoy.temas ?? []).map((tm) => (
          <li key={`tema-${tm.clave}`}>
            <span className="tu-dia-num">{++n}</span>
            <button className="enlace" onClick={() => irA('repaso')}>
              {t('hoy.recordarEntera')} <b className="tu-dia-clave">{tm.clave}</b> {tituloSencillo(indice, tm.clave, tm.titulo)}
            </button>
            <small>{t('hoy.repasoDelTema')}</small>
          </li>
        ))}
        {hoy.repasos > 0 && (
          <li>
            <span className="tu-dia-num">{++n}</span>
            <button className="enlace" onClick={() => irA('repaso')}>
              {t('hoy.repasarN', { n: hoy.repasos, conceptos: hoy.repasos === 1 ? t('hoy.concepto') : t('hoy.conceptos') })}
            </button>
            <small>{t('hoy.unosMin', { min: minutosRepaso ?? '·' })}</small>
          </li>
        )}
        {dia.map((s) => {
          const p = variosPlanes ? temaDeSesion(s.plan_id) : undefined
          // El índice (los títulos sencillos) es el del plan de hoy: a las sesiones de otro plan no se les aplica.
          const ix = s.plan_id == null || s.plan_id === hoy.plan_id ? indice : null
          return (
            <li key={s.sesion_id ?? `${s.plan_id}-${s.clave}`} className={s.estado === 'hecha' ? 'hecho' : ''}>
              <span className="tu-dia-num">{s.estado === 'hecha' ? '✓' : ++n}</span>
              <span>
                <b className="tu-dia-clave">{s.clave}</b> {tituloSencillo(ix, s.clave, s.titulo)}
              </span>
              {p && (
                <span className="tu-dia-tema con-punto-tema" title={p.tema}>
                  <span className="punto-tema" style={colorDeTema(p.tema_id, planes)?.estilo} aria-hidden="true" />
                  {nombreCorto(p.tema, 18)}
                </span>
              )}
              <small>{horas(s.horas)} h</small>
            </li>
          )
        })}
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
  const atrasado = examen.fecha < hoyIso()
  return (
    <section className="tutor-examen">
      <div>
        <span className="vacio-etq">{atrasado ? t('hoy.examenPend') : t('hoy.tocaExamen')}</span>
        <strong>{examen.titulo}</strong>
        <small>
          {t('hoy.examenInfo', { n: examen.preguntas, min: examen.minutos })}
          {despues?.length ? t('hoy.mejorAlAcabar', { lista: despues.join(t('hoy.y')) }) : ''}
          {examen.nota != null ? t('hoy.mejorNota', { nota: numero(Math.round(examen.nota * 10) / 10, 1) }) : ''}
        </small>
      </div>
      {examen.plan_id && (
        <button className="boton boton-principal" onClick={() => irARuta(rutaExamen(examen.plan_id!, examen))}>
          {t('hoy.hacerExamen')}
        </button>
      )}
    </section>
  )
}

// Lo que dejaste a medias fuera de Proyectos: una línea por cosa, con su enlace y una × para quitarla.
function FranjaAMedias({ avisos, alIr, alDescartar }: { avisos: AMedias[]; alIr: (a: AMedias) => void; alDescartar: (id: string) => void }) {
  if (!avisos.length) return null
  return (
    <section className="a-medias" aria-label={t('hoy.aMediasAria')}>
      <span className="a-medias-etq">{t('hoy.aMedias')}</span>
      <ul>
        {avisos.map((a) => (
          <li key={a.id}>
            <span>{a.texto}</span>
            <button className="boton-mini" onClick={() => alIr(a)}>
              {a.boton} →
            </button>
            <button className="a-medias-quitar" onClick={() => alDescartar(a.id)} aria-label={t('hoy.quitarAviso', { texto: a.texto })} title={t('hoy.quitarAvisoTitulo')}>
              ×
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

export const saludo = () => {
  const h = new Date().getHours()
  return h < 6 ? t('hoy.buenasNoches') : h < 14 ? t('hoy.buenosDias') : h < 21 ? t('hoy.buenasTardes') : t('hoy.buenasNoches')
}

// «Hoy»: tus cifras, tu día y la lección de hoy (el tutor que te guía está en PanelGuia).
// vista «foco»: su propia entrada en la barra lateral, con todas las lecciones para elegir.
export default function PanelTutor({ irA, vista = 'hoy' }: { irA: (m: IdModo) => void; vista?: 'hoy' | 'foco' }) {
  usarIdioma() // los textos siguen al idioma
  const [hoy, setHoy] = useState<Hoy | null>(null)
  const indiceHoy = usarIndice(hoy?.plan_id)
  const [leccion, setLeccion] = useState<Leccion | null>(null)
  const [otras, setOtras] = useState<Opcion[]>([])
  const [planes, setPlanes] = useState<ResumenPlan[]>([])
  const [avance, setAvance] = useState<Avance | null>(null)
  const [inicialFoco, setInicialFoco] = useState<Avance | null>(null)
  const [minutosRepaso, setMinutosRepaso] = useState<number | null>(null)
  const [semana, setSemana] = useState<{ hechas: number; total: number; sesiones: number; hechasN: number } | null>(null)
  // «Lo dejaste a medias»: el material que terminó desde tu visita anterior, las últimas conversaciones y lo descartado.
  const [listosNuevos, setListosNuevos] = useState<MaterialListo[]>([])
  const [ultimasConversaciones, setUltimasConversaciones] = useState<UltimaConversacion[]>([])
  const [descartados, setDescartados] = useState<string[]>(leerDescartados)
  const [fallo, setFallo] = useState<string | null>(null)
  const [leccionPerdida, setLeccionPerdida] = useState(false)
  const [intento, setIntento] = useState(0)
  const reintentar = useCallback(() => {
    setFallo(null)
    setIntento((x) => x + 1)
  }, [])
  const avisoPerdida = leccionPerdida && (
    <p className="nota" role="status">
      {t('hoy.perdida')}
    </p>
  )

  const abrir = useCallback(async (mid: number, idea: number | null = null) => {
    // Lo que llevabas de la lección que abres va aparte del avance de la de hoy (la tarjeta): si no, la respuesta
    // de /api/hoy que llega después lo pisaría y empezarías arriba.
    setInicialFoco(aplicarIdea(leerAvance(mid), idea))
    setLeccionPerdida(false)
    try {
      setLeccion(await cargarLeccion(mid))
    } catch (e) {
      // Un enlace a unos apuntes que ya no están (#/foco/99999): se dice y se queda la lista, sin reintentar.
      if (e instanceof ErrorApi && e.codigo === 404) setLeccionPerdida(true)
      else setFallo(t('hoy.noAbrir', { motivo: mensajeDe(e) }))
    }
  }, [])

  // La ruta se lee una sola vez, al llegar (si luego cambia lo de hoy, no se vuelve a abrir la lección).
  const rutaLeida = useRef(false)
  useEffect(() => {
    // #/hoy/foco entra en la lección de hoy; #/hoy/foco/12, en la de esos apuntes.
    // En la vista foco, #/foco abre la lista, #/foco/hoy la de hoy, #/foco/12 esos apuntes y #/foco/12/3 su idea 3
    // (es la ruta que lleva una lección abierta: recargar te deja donde estabas).
    const ruta = rutaLeida.current ? { entrar: false, mid: null, idea: null } : leerRutaFoco(window.location.hash, vista)
    rutaLeida.current = true
    // La historia guarda a dónde volver al salir: no se pierde al limpiar la ruta.
    if (ruta.entrar) window.history.replaceState(window.history.state, '', vista === 'foco' ? '#/foco' : '#/hoy')
    pedir<Hoy>('/api/hoy')
      .then((h) => {
        setHoy(h)
        if (h.material_id) setAvance(leerAvance(h.material_id))
        if (ruta.entrar) {
          const elegido = ruta.mid || (h.estado !== 'sin_preparar' ? h.material_id : null)
          if (elegido) abrir(elegido, ruta.idea)
        }
      })
      .catch((e) => setFallo(mensajeDe(e)))
    pedir<{ minutos: number }[]>('/api/practica/cola')
      .then((c) => setMinutosRepaso(Math.round(c.reduce((a, x) => a + x.minutos, 0))))
      .catch(() => undefined)
    listarPlanes().then(async (ps) => {
      setPlanes(ps)
      // Cada plan con su vista y sus materiales, todos a la vez (antes iban uno tras otro y el primero dos veces).
      const vistas = await Promise.all(
        ps.map((p) =>
          Promise.all([
            verPlan(p.tema_id),
            pedir<Record<string, { apuntes_id?: number; apuntes_listos?: boolean; tipos?: Record<string, string>; ids?: Record<string, number> }>>(
              `/api/planes/${p.plan_id}/materiales`,
            ),
          ]),
        ),
      )
      // Esta semana: horas y sesiones hechas frente a las previstas (lunes a domingo), de todos los planes, como
      // «Lo que toca» (antes solo contaba el primero y no cuadraba con la lista).
      if (vistas.length) setSemana(semanaDeTodos(vistas.map(([v]) => v), hoyIso()))
      const lista: Opcion[] = []
      ps.forEach((p, i) => {
        const [v, estados] = vistas[i]
        for (const l of v.lecciones) {
          // «Empezar» solo con apuntes que se pueden estudiar (listos o por revisar): unos a medias o bloqueados llevan a
          // prepararlos. `apuntes_listos` lo da el servidor; uno de antes, por el estado del tipo.
          const e = estados[l.clave]
          const listos = e?.apuntes_listos ?? ['listo', 'revisar'].includes(e?.tipos?.apuntes ?? '')
          lista.push({ clave: l.clave, titulo: l.titulo, material_id: listos ? e?.apuntes_id ?? null : null, plan_id: p.plan_id, tema_id: p.tema_id })
        }
      })
      setOtras(lista)
      // Lo listo ahora frente a la foto de tu visita anterior: lo nuevo es lo que terminó mientras no estabas.
      const listos: MaterialListo[] = []
      ps.forEach((p, i) => {
        for (const [clave, d] of Object.entries(vistas[i][1])) {
          for (const [tipo, estado] of Object.entries(d.tipos ?? {})) {
            const id = d.ids?.[tipo]
            if (estado === 'listo' && id != null) listos.push({ id, tipo, clave, tema_id: p.tema_id })
          }
        }
      })
      setListosNuevos(nuevosListos(listos, fotoAlLlegar(listos.map(claveListo))))
    }).catch(() => undefined)
    // Las dos conversaciones más recientes y su último mensaje: si se cortó o el tutor espera tu respuesta (solo en Hoy).
    if (vista === 'hoy') {
      listarConversaciones()
        .then((cs) =>
          Promise.all(
            cs.slice(0, 2).map(async (c) => {
              const ms = await listarMensajes(c.id)
              const m = ms[ms.length - 1]
              return { id: c.id, titulo: c.titulo, actualizada_en: c.actualizada_en, ultimo: m ? { id: m.id, rol: m.rol, estado: m.estado, contenido: m.contenido } : null }
            }),
          ),
        )
        .then(setUltimasConversaciones)
        .catch(() => undefined)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abrir, intento])
  // El asesor ha movido una sesión o marcado una lección: lo que toca hoy puede haber cambiado.
  useEffect(() => {
    const al = () => setIntento((x) => x + 1)
    window.addEventListener(EVENTO_CAMBIO_APLICADO, al)
    return () => window.removeEventListener(EVENTO_CAMBIO_APLICADO, al)
  }, [])

  const empezar = (mid: number, desdeCero = false) => {
    if (desdeCero) guardarAvance(mid, null)
    pedirPantallaCompleta()
    abrir(mid)
  }

  if (!hoy) return <Cargando texto={t('hoy.preparando')} error={fallo} reintentar={reintentar} />

  if (leccion)
    return (
      <FocoLeccion
        key={leccion.material_id}
        leccion={leccion}
        sesionId={
          hoy.dia?.find((s) => s.material_id === leccion.material_id && s.estado !== 'hecha')?.sesion_id ??
          (leccion.material_id === hoy.material_id ? hoy.sesion_id : undefined)
        }
        horas={
          hoy.dia?.find((s) => s.material_id === leccion.material_id && s.estado !== 'hecha')?.horas ??
          (leccion.material_id === hoy.material_id ? hoy.horas : undefined)
        }
        repasos={hoy.repasos}
        inicial={inicialFoco}
        irA={irA}
        alSalir={() => {
          setLeccion(null)
          if (hoy.material_id) setAvance(leerAvance(hoy.material_id))
        }}
      />
    )

  if (vista === 'foco')
    return (
      <>
        {fallo && <Cargando error={fallo} reintentar={reintentar} />}
        {avisoPerdida}
        <ElegirFoco hoy={hoy} otras={otras} empezar={empezar} />
      </>
    )

  if (hoy.estado === 'sin_plan')
    return (
      <div className="panel">
        <Vacio
          etiqueta={t('vacio.tutor.etq')}
          titulo={t('vacio.tutor.titulo')}
          texto={t('vacio.tutor.texto')}
          acciones={[{ texto: t('vacio.crearPlan'), principal: true, alPulsar: () => irARuta('#/nuevo-plan') }]}
        />
      </div>
    )

  const seguir = avance && hoy.material_id ? textoSeguir(avance, Date.now()) : null
  const avisosAMedias = aMedias(
    {
      avances: leerAvancesFoco(),
      practica: leerPractica(),
      repasosPendientes: hoy.repasos,
      lecciones: otras,
      deHoy: hoy.estado !== 'sin_preparar' && hoy.estado !== 'solo_repaso' ? hoy.material_id : null,
      conversaciones: ultimasConversaciones,
      listosNuevos,
      descartados,
    },
    Date.now(),
  )
  const irAMedias = (a: AMedias) => (a.destino.tipo === 'foco' ? empezar(a.destino.mid) : irARuta(a.destino.ruta))
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
          <h1>{t('hoy.titulo')}</h1>
          <p className="nota hoy-fecha">{new Date().toLocaleDateString(idiomaActual() === 'en' ? 'en-GB' : 'es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        </div>
      </header>
      {fallo && <Cargando error={fallo} reintentar={reintentar} />}
      {avisoPerdida}
      <div className="hoy-resumen">
        <button className="hoy-cifra" onClick={() => irA('repaso')} disabled={!hoy.repasos}>
          <strong>{hoy.repasos}</strong>
          <span>{hoy.repasos === 1 ? t('hoy.repaso') : t('hoy.repasos')}</span>
          <small>
            {hoy.repasos
              ? `${hoy.nuevos ? `${hoy.nuevos} ${hoy.nuevos === 1 ? t('hoy.conceptoNuevo') : t('hoy.conceptosNuevos')} · ` : ''}${t('hoy.minRepasar', { min: minutosRepaso ?? '·' })}`
              : t('hoy.nadaPendiente')}
          </small>
        </button>
        {semana && (
          <div className="hoy-cifra">
            <strong>
              {numero(semana.hechas, 1)} <small>{t('hoy.deHoras', { total: numero(semana.total, 1) })}</small>
            </strong>
            <span>{t('hoy.estaSemana')}</span>
            <span className="barra">
              <span style={{ width: `${semana.total ? (semana.hechas / semana.total) * 100 : 0}%` }} />
            </span>
            <small>
              {t('hoy.sesionesDe', { hechas: semana.hechasN, sesiones: pluralT(semana.sesiones, 'hoy.sesion', 'hoy.sesiones') })}
              {planes.length > 1 ? t('hoy.nPlanes', { n: planes.length }) : ''}
            </small>
          </div>
        )}
        <button className="hoy-cifra" onClick={() => irA('examen')}>
          <strong>{hoy.examen ? '1' : '0'}</strong>
          <span>{hoy.examen ? t('hoy.examenPendiente') : t('hoy.examenesPendientes')}</span>
          <small>{hoy.examen ? `${hoy.examen.titulo} →` : t('hoy.hacerUno')}</small>
        </button>
      </div>
      <FranjaAMedias avisos={avisosAMedias} alIr={irAMedias} alDescartar={(id) => setDescartados(descartar(id))} />
      <TuDia hoy={hoy} minutosRepaso={minutosRepaso} irA={irA} planes={planes} />
      {hoy.examen && !examenDespues.length && <TarjetaExamen examen={hoy.examen} />}
      {hoy.titulo && hoy.estado !== 'solo_repaso' ? (
        <section className="tutor-hoy">
          <span className="vacio-etq">{t('hoy.etiqueta', { razon: hoy.razon ?? '' })}</span>
          <h1>
            <span className="bloques-clave">{hoy.leccion_clave}</span> {tituloSencillo(indiceHoy, hoy.leccion_clave ?? '', hoy.titulo)}
          </h1>
          <p className="nota">
            {planes.length > 1 && <span className="punto-tema" style={colorDeTema(hoy.tema_id, planes)?.estilo} aria-hidden="true" />}
            {t('hoy.horasPrevistas', { tema: hoy.tema ?? '', h: numero(Number(hoy.horas), 2) })}
          </p>
          {hoy.estado === 'sin_preparar' || !hoy.material_id ? (
            <>
              <p>{t('hoy.sinPreparar')}</p>
              <div className="vacio-acciones">
                <button
                  className="boton boton-principal"
                  onClick={() => (hoy.tema_id ? irARuta(`#/fichas/${hoy.tema_id}/${hoy.leccion_clave}`) : irA('fichas'))}
                >
                  {t('hoy.prepararla')}
                </button>
              </div>
            </>
          ) : (
            <>
              <ul className="tutor-como">
                <li>{t('hoy.como1')}</li>
                <li>{t('hoy.como2')}</li>
                <li>{t('hoy.como3')}</li>
              </ul>
              <div className="vacio-acciones">
                <button className="boton boton-principal" onClick={() => empezar(hoy.material_id!)}>
                  {seguir ?? t('hoy.empezarFoco')}
                </button>
                {seguir && (
                  <button className="boton" onClick={() => empezar(hoy.material_id!, true)}>
                    {t('hoy.deCero')}
                  </button>
                )}
                <button className="boton" onClick={() => irARuta(`#/llamada/clase/${hoy.leccion_clave}`)} title={t('hoy.llamadaTitulo')}>
                  {t('hoy.llamada')}
                </button>
                {hoy.repasos > 0 && (
                  <button className="boton" onClick={() => irA('repaso')}>
                    {t('hoy.antesRepasos', { n: hoy.repasos })}
                  </button>
                )}
              </div>
            </>
          )}
        </section>
      ) : (
        <Vacio
          etiqueta={t('vacio.hoy.etq')}
          titulo={hoy.repasos ? t('vacio.hoy.repasar') : t('vacio.hoy.nada')}
          texto={
            hoy.repasos
              ? t('vacio.hoy.textoRepasos', { n: hoy.repasos })
              : t('vacio.hoy.textoNada')
          }
          acciones={hoy.repasos ? [{ texto: t('vacio.hoy.accion'), principal: true, alPulsar: () => irA('repaso') }] : []}
        />
      )}
      {hoy.examen && examenDespues.length > 0 && <TarjetaExamen examen={hoy.examen} despues={examenDespues} />}
      {otras.some((o) => o.material_id && o.material_id !== hoy.material_id) && (
        <p className="tutor-otras-enlace">
          <button className="boton" onClick={() => irA('foco')}>
            {t('hoy.otraFoco')}
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
  if (sueltas.length) grupos.push({ nombre: t('foco.otras'), lecciones: sueltas })
  if (!otras.length)
    return (
      <div className="panel">
        <Vacio
          etiqueta={t('vacio.foco.etq')}
          titulo={t('vacio.foco.titulo')}
          texto={t('vacio.foco.texto')}
          acciones={[{ texto: t('vacio.crearPlan'), principal: true, alPulsar: () => irARuta('#/nuevo-plan') }]}
        />
      </div>
    )
  return (
    <div className="tutor-inicio foco-elegir">
      <header>
        <h1>{t('foco.titulo')}</h1>
        <p className="nota">{t('foco.nota')}</p>
      </header>
      {deHoy?.material_id && (
        <section className="tutor-hoy">
          <span className="vacio-etq">{t('foco.laDeHoy')}</span>
          <h1>
            <span className="bloques-clave">{deHoy.clave}</span> {tituloSencillo(ix, deHoy.clave, deHoy.titulo)}
          </h1>
          <div className="vacio-acciones">
            <button className="boton boton-principal" onClick={() => empezar(deHoy.material_id!)}>
              {avanceHoy ? textoSeguir(avanceHoy, Date.now()) : t('foco.empezar')}
            </button>
            {avanceHoy && (
              <button className="boton" onClick={() => empezar(deHoy.material_id!, true)}>
                {t('hoy.deCero')}
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
                      title={o.material_id ? o.titulo : t('foco.sinPrepararTitulo')}
                    >
                      <span className="bloques-clave">{o.clave}</span>
                      <span>{tituloSencillo(ix, o.clave, o.titulo)}</span>
                      <small>{!o.material_id ? t('foco.prepararlaFlecha') : av ? textoSeguir(av, Date.now()) : t('foco.empezarFlecha')}</small>
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
