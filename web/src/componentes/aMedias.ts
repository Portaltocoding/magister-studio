// «Lo dejaste a medias»: lo que quedó sin acabar fuera de Proyectos (una lección en foco, una respuesta del tutor que se
// cortó o que espera la tuya, un repaso que dejaste a mitad, material que terminó mientras no estabas) y dónde retomarlo.
// Solo con lo que ya hay: el avance del foco y la tanda de repaso en localStorage, las conversaciones y los materiales
// de la API. Los exámenes no entran.

export const MAX_A_MEDIAS = 3
const DIA = 86_400_000
// Un avance o una conversación más viejos que esto ya no son «a medias»: son otra cosa.
const CADUCA_DIAS = 14
// Una conversación tocada hace menos de esto: sigues en ella, no se avisa.
const RECIEN_MS = 10 * 60_000

export interface AvanceLeido {
  mid: number
  i: number
  n?: number // cuántas ideas tiene la lección (los avances viejos no lo traen)
  u?: number
  segundos?: number
  comprobado?: Record<string, string>
  en?: number // cuándo se guardó (ms)
}

export interface LeccionConocida {
  material_id: number | null
  clave: string
  titulo: string
  tema_id: number
}

export interface UltimaConversacion {
  id: number
  titulo: string
  actualizada_en: string
  ultimo: { id: number; rol: 'usuario' | 'tutor'; estado: string; contenido: string } | null
}

export interface MaterialListo {
  id: number
  tipo: string // apuntes, guion, diapositivas
  clave: string
  tema_id: number
}

// La tanda de repaso (Practicar → Repaso) que empezaste: cuántas había al empezar y cuántas llevabas al salir.
export interface PracticaLeida {
  total: number
  hechas: number
  en: number // cuándo se guardó (ms)
}

export interface Lectura {
  avances: AvanceLeido[]
  // La tanda de repaso sin acabar y cuántos repasos quedan hoy (sin ninguno pendiente ya no está a medias).
  practica?: PracticaLeida | null
  repasosPendientes?: number
  lecciones: LeccionConocida[]
  // Los apuntes de hoy: su «Seguir por la idea N» ya está en la tarjeta de hoy.
  deHoy?: number | null
  conversaciones: UltimaConversacion[]
  listosNuevos: MaterialListo[]
  descartados: readonly string[]
}

export type Destino = { tipo: 'foco'; mid: number } | { tipo: 'ruta'; ruta: string }

export interface AMedias {
  id: string // para descartarlo; cambia si cambia lo que dice
  texto: string
  boton: string
  destino: Destino
  en: number
}

export function cuando(en: number, ahora: number): string {
  const d0 = new Date(en)
  const d1 = new Date(ahora)
  const dias = Math.round(
    (new Date(d1.getFullYear(), d1.getMonth(), d1.getDate()).getTime() - new Date(d0.getFullYear(), d0.getMonth(), d0.getDate()).getTime()) / DIA,
  )
  if (dias <= 0) return 'hoy'
  if (dias === 1) return 'ayer'
  return `hace ${dias} días`
}

const NOMBRE_MATERIAL: Record<string, { texto: (c: string) => string; boton: string; ruta: (m: MaterialListo) => string }> = {
  apuntes: { texto: (c) => `Ya están los apuntes de ${c}.`, boton: 'Abrirlos', ruta: (m) => `#/fichas/${m.tema_id}/${m.clave}` },
  guion: { texto: (c) => `Ya está el vídeo de ${c}.`, boton: 'Verlo', ruta: () => '#/video' },
  diapositivas: {
    texto: (c) => `Ya están las diapositivas de ${c}.`,
    boton: 'Verlas',
    ruta: (m) => `#/fichas/${m.tema_id}/${m.clave}/diapositivas`,
  },
}

// El tutor acabó con una pregunta y no le contestaste. Se mira el final, sin el adorno de markdown o comillas.
const acabaPreguntando = (t: string) => /\?[\s*_)»"'”]*$/.test(t.trim())

// Lo que se enseña, como mucho tres, de lo más reciente a lo más viejo. `ahora` entra como argumento (ms).
export function aMedias(l: Lectura, ahora: number): AMedias[] {
  const fuera = new Set(l.descartados)
  const todos: AMedias[] = []

  for (const m of l.listosNuevos) {
    const t = NOMBRE_MATERIAL[m.tipo]
    if (!t || (m.tipo === 'apuntes' && m.id === l.deHoy)) continue // los de hoy ya los ofrece su tarjeta
    // El material nuevo es una noticia: va delante de lo que llevas días sin tocar.
    todos.push({ id: `mat:${m.tipo}:${m.id}`, texto: t.texto(m.clave), boton: t.boton, destino: { tipo: 'ruta', ruta: t.ruta(m) }, en: ahora })
  }

  for (const a of l.avances) {
    if (a.mid === l.deHoy) continue
    const lec = l.lecciones.find((x) => x.material_id === a.mid)
    if (!lec) continue // unos apuntes que ya no están (rehechos o borrados)
    // Abrirla y salir enseguida no es dejarla a medias.
    const empezada = a.i > 0 || (a.u ?? 0) > 0 || Object.keys(a.comprobado ?? {}).length > 0 || (a.segundos ?? 0) >= 60
    if (!empezada) continue
    if (a.en != null && ahora - a.en > CADUCA_DIAS * DIA) continue
    const idea = a.n ? `la idea ${a.i + 1} de ${a.n}` : `la idea ${a.i + 1}`
    const texto = a.en != null ? `Lo dejaste ${cuando(a.en, ahora)} en ${idea} de ${lec.clave}.` : `Te quedaste en ${idea} de ${lec.clave}.`
    todos.push({ id: `foco:${a.mid}:${a.i}`, texto, boton: `Seguir por la idea ${a.i + 1}`, destino: { tipo: 'foco', mid: a.mid }, en: a.en ?? 0 })
  }

  // Un repaso a mitad: al menos una respondida (abrir la primera y salir no cuenta) y aún te queda alguno.
  const p = l.practica
  if (p && p.hechas > 0 && (l.repasosPendientes ?? 0) > 0 && ahora - p.en <= CADUCA_DIAS * DIA) {
    const llevabas = p.hechas < p.total ? `: llevabas ${p.hechas} de ${p.total}` : ''
    todos.push({ id: `practica:${p.en}`, texto: `Dejaste el repaso a medias ${cuando(p.en, ahora)}${llevabas}.`, boton: 'Seguir repasando', destino: { tipo: 'ruta', ruta: '#/repaso' }, en: p.en })
  }

  for (const c of l.conversaciones) {
    const m = c.ultimo
    if (!m) continue
    const en = new Date(c.actualizada_en).getTime()
    if (!Number.isFinite(en) || ahora - en < RECIEN_MS || ahora - en > CADUCA_DIAS * DIA) continue
    const ruta = `#/conversacion/${c.id}`
    const cortada = m.rol === 'usuario' || m.estado === 'interrumpido' || m.estado === 'error'
    if (cortada)
      todos.push({ id: `conv:${c.id}:${m.id}`, texto: `La respuesta del tutor se cortó en «${c.titulo}».`, boton: 'Retomarla', destino: { tipo: 'ruta', ruta }, en })
    else if (m.rol === 'tutor' && acabaPreguntando(m.contenido))
      todos.push({ id: `conv:${c.id}:${m.id}`, texto: `El tutor te hizo una pregunta en «${c.titulo}» y está sin contestar.`, boton: 'Contestar', destino: { tipo: 'ruta', ruta }, en })
  }

  return todos.filter((x) => !fuera.has(x.id)).sort((a, b) => b.en - a.en).slice(0, MAX_A_MEDIAS)
}

// Lo que está listo ahora y no lo estaba al llegar. Sin una foto anterior (la primera vez) no hay nada nuevo: si no,
// todo tu material saldría como recién hecho.
export const claveListo = (m: { tipo: string; id: number }) => `${m.tipo}:${m.id}`
export function nuevosListos<M extends { tipo: string; id: number }>(actuales: readonly M[], alLlegar: readonly string[] | null): M[] {
  if (alLlegar == null) return []
  const antes = new Set(alLlegar)
  return actuales.filter((m) => !antes.has(claveListo(m)))
}

// ===== Lo leído y lo recordado (con el almacenamiento del navegador; sin él, nada) =====

const CLAVE_DESCARTADOS = 'magister-a-medias-descartados'
const CLAVE_LISTOS = 'magister-listos' // lo listo la última vez que abriste «Hoy»
const CLAVE_AL_LLEGAR = 'magister-listos-al-llegar' // la foto de antes de esta visita (sessionStorage)

export function leerAvancesFoco(): AvanceLeido[] {
  const salida: AvanceLeido[] = []
  try {
    for (let k = 0; k < localStorage.length; k++) {
      const clave = localStorage.key(k) ?? ''
      const m = /^magister-foco-(\d+)$/.exec(clave)
      if (!m) continue
      const a = JSON.parse(localStorage.getItem(clave) ?? 'null')
      if (a && typeof a.i === 'number') salida.push({ ...a, mid: Number(m[1]) })
    }
  } catch {
    /* sin almacenamiento o un avance roto: se enseña lo que se pudo leer */
  }
  return salida
}

const CLAVE_PRACTICA = 'magister-practica-tanda'

export function leerPractica(): PracticaLeida | null {
  try {
    const p = JSON.parse(localStorage.getItem(CLAVE_PRACTICA) ?? 'null')
    return p && typeof p.hechas === 'number' && typeof p.total === 'number' && typeof p.en === 'number' ? p : null
  } catch {
    return null
  }
}

// La tanda en curso (con null, acabada: ya no está a medias).
export function guardarPractica(p: PracticaLeida | null) {
  try {
    if (p) localStorage.setItem(CLAVE_PRACTICA, JSON.stringify(p))
    else localStorage.removeItem(CLAVE_PRACTICA)
  } catch {
    /* sin almacenamiento: no se avisa */
  }
}

export function leerDescartados(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(CLAVE_DESCARTADOS) ?? '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

export function descartar(id: string): string[] {
  const v = [...leerDescartados().filter((x) => x !== id), id].slice(-100)
  try {
    localStorage.setItem(CLAVE_DESCARTADOS, JSON.stringify(v))
  } catch {
    /* sin almacenamiento: se quita solo de la pantalla */
  }
  return v
}

// La foto de lo listo al llegar (la de tu visita anterior) y se guarda la de ahora para la siguiente. Dentro de la
// misma visita (la pestaña abierta) la foto de llegada no cambia: recargar no se come los avisos.
export function fotoAlLlegar(actuales: readonly string[]): string[] | null {
  try {
    let alLlegar = sessionStorage.getItem(CLAVE_AL_LLEGAR)
    if (alLlegar == null) {
      alLlegar = localStorage.getItem(CLAVE_LISTOS) ?? 'null'
      sessionStorage.setItem(CLAVE_AL_LLEGAR, alLlegar)
    }
    localStorage.setItem(CLAVE_LISTOS, JSON.stringify(actuales))
    const v = JSON.parse(alLlegar)
    return Array.isArray(v) ? v : null
  } catch {
    return null
  }
}
