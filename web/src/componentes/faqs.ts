import { t, type Clave } from '../i18n/i18n.ts'

// Las preguntas frecuentes del asesor: se contestan al instante, en la propia pantalla, sin llamar al modelo.
// Cada una dice en qué secciones sale primero («*», en todas) y sus palabras clave para reconocerla aunque la escribas
// a tu manera. La respuesta es Markdown y puede acabar en un bloque `acciones` («Texto | #/ruta») con botones para ir.
// Los textos (pregunta, respuesta, palabras clave y botón) viven en el diccionario (faq.<id>.p, .r, .c y .b) y salen en
// el idioma de ahora. Si algo de la app cambia, se cambia allí: el asesor contesta con lo que pone.

export interface Faq {
  id: string
  pregunta: string
  respuesta: string
  secciones: string[]
  claves: string[]
}

const ir = (texto: string, ruta: string) => `\n\n\`\`\`acciones\n${texto} | ${ruta}\n\`\`\``

// Lo que no es texto: el id, la ruta del botón (si lo tiene) y las secciones donde sale primero.
const DATOS: { id: string; ruta?: string; secciones: string[] }[] = [
  { id: 'plan', ruta: '#/roadmap', secciones: ['roadmap', 'hoy', 'libre', 'calendario'] },
  { id: 'atrasado', ruta: '#/roadmap', secciones: ['roadmap', 'hoy', 'calendario'] },
  { id: 'hoy', ruta: '#/hoy', secciones: ['*'] },
  { id: 'material', ruta: '#/fichas', secciones: ['fichas', 'hoy', 'roadmap'] },
  { id: 'video', ruta: '#/video', secciones: ['video', 'fichas'] },
  { id: 'barras', secciones: ['*'] },
  { id: 'repaso', ruta: '#/repaso', secciones: ['repaso', 'hoy', 'examen'] },
  { id: 'examen', ruta: '#/examen', secciones: ['examen', 'repaso', 'hoy'] },
  { id: 'fuentes', ruta: '#/temas', secciones: ['temas', 'libre', 'buscar', 'web'] },
  { id: 'buscar', ruta: '#/buscar', secciones: ['buscar', 'temas', 'fichas'] },
  { id: 'notas', ruta: '#/notas', secciones: ['notas', 'libre'] },
  { id: 'afinar', secciones: ['*'] },
  { id: 'aprendido', secciones: ['libre', '*'] },
  { id: 'charla', ruta: '#/llamada', secciones: ['llamada', 'hoy', 'repaso'] },
  { id: 'foco', ruta: '#/foco', secciones: ['foco', 'hoy', 'fichas'] },
  { id: 'progreso', ruta: '#/progreso', secciones: ['progreso', 'hoy', 'roadmap'] },
  { id: 'automatizar', ruta: '#/automatizar', secciones: ['automatizar', 'roadmap'] },
  { id: 'no_cuenta', secciones: ['libre'] },
  { id: 'mascota', secciones: ['*'] },
]

// Las preguntas frecuentes en el idioma de ahora.
export function faqs(): Faq[] {
  return DATOS.map((d) => ({
    id: d.id,
    pregunta: t(`faq.${d.id}.p` as Clave),
    respuesta: t(`faq.${d.id}.r` as Clave) + (d.ruta ? ir(t(`faq.${d.id}.b` as Clave), d.ruta) : ''),
    secciones: d.secciones,
    claves: t(`faq.${d.id}.c` as Clave).split(',').map((x) => x.trim()),
  }))
}

// ===== Reconocer una pregunta escrita a tu manera =====

const VACIAS = new Set(
  ('a al algo como con cual cuando de del donde el en es esta este esto la las le lo los me mi mis o para por que se si su sus te tu un una y yo hay hago puedo quiero ver ' +
    'a an and are can do does how i in is it my of on or the to what where which with you your want see')
    .split(' '),
)
const raiz = (p: string) => p.slice(0, 5)
const palabras = (t: string) =>
  t
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^a-z0-9ñ]+/)
    .filter((p) => p.length > 1 && !VACIAS.has(p))
    .map(raiz)

// La frecuente que corresponde a lo que has escrito, si se parece de verdad (si no, null: contesta el modelo).
export function buscarFaq(texto: string): Faq | null {
  const q = new Set(palabras(texto))
  if (!q.size) return null
  let mejor: { faq: Faq; nota: number } | null = null
  for (const faq of faqs()) {
    // Las claves pasan por la misma normalización que la pregunta (tildes, mayúsculas, raíz).
    const suyas = new Set([...palabras(faq.claves.join(' ')), ...palabras(faq.pregunta)])
    const comunes = [...q].filter((p) => suyas.has(p)).length
    const nota = comunes / q.size
    // Una sola palabra solo vale si es una de sus dos claves principales («barra», «video»), no una genérica («nuevo»).
    const basta = q.size === 1 ? palabras(faq.claves.slice(0, 2).join(' ')).includes([...q][0]) : comunes >= 2
    if (basta && nota >= 0.6 && (!mejor || nota > mejor.nota)) mejor = { faq, nota }
  }
  return mejor?.faq ?? null
}

// Las de esta sección primero y luego las generales, sin repetir.
export function faqsDe(seccion: string): Faq[] {
  const todas = faqs()
  const propias = todas.filter((f) => f.secciones.includes(seccion))
  const generales = todas.filter((f) => f.secciones.includes('*') && !propias.includes(f))
  return [...propias, ...generales]
}

// ===== Lo que el chat vacío te sugiere =====

const explicame = () => t('faq.explicame')
// En un proyecto abierto, el asesor puede cambiarlo: las sugerencias lo enseñan pidiéndole un cambio de verdad.
export const sugerenciasProyecto = (): string[] => [explicame(), t('faq.sug.pasos'), t('faq.sug.reorganiza')]

// En las pantallas del plan, con un plan activo, el asesor puede cambiarlo (mover una sesión, marcar una lección,
// preparar sus apuntes): las sugerencias lo enseñan pidiéndole un cambio de verdad.
export const sugerenciasPlan = (): Record<string, string[]> => {
  const mueve = t('faq.sug.mueve')
  const marca = t('faq.sug.marca')
  return {
    hoy: [explicame(), mueve, marca],
    calendario: [explicame(), mueve, t('faq.sug.examen')],
    roadmap: [explicame(), mueve, t('faq.sug.apuntes')],
    fichas: [explicame(), marca, mueve],
  }
}
export const esPantallaDePlan = (seccion: string) => seccion.split('/')[0] in sugerenciasPlan()

// Las tres sugerencias del chat vacío. `seccion` es la clave de la ruta ('repaso', 'proyectos/12'…); `hayPlan`, si
// tienes un plan activo.
export function sugerenciasDe(seccion: string, enProyecto: boolean, hayPlan = false): string[] {
  if (enProyecto) return sugerenciasProyecto()
  if (hayPlan && esPantallaDePlan(seccion)) return [...sugerenciasPlan()[seccion.split('/')[0]]]
  const otras = faqsDe(seccion.split('/')[0]).map((f) => f.pregunta)
  return [...new Set([explicame(), ...otras])].slice(0, 3)
}

// ===== ¿Ha ofrecido un cambio sin prepararlo? =====

// El asesor ofrece un cambio en una pregunta final («¿Lo añado al nivel 1?», «¿Quieres que lo guarde en tus notas?»).
// Si la reconocemos, bajo la respuesta salen «Sí, prepáralo» y «No, déjalo». Conservadora: ante la duda, no.
const YO = 'añado|agrego|meto|pongo|incluyo|muevo|cambio|quito|borro|elimino|ordeno|reordeno|reorganizo|renombro|apunto|anoto|guardo|marco|parto|divido|separo|junto|preparo|hago'
const QUE = 'añada|agregue|meta|ponga|incluya|mueva|cambie|quite|borre|elimine|ordene|reordene|reorganice|renombre|apunte|anote|guarde|marque|parta|divida|separe|junte|prepare|haga'
// Sin pronombre, solo los verbos que no pueden ser otra cosa («¿Cambio de nivel?» no es una oferta).
const SOLOS = 'añado|agrego|muevo|quito|reordeno|reorganizo|renombro|apunto|anoto|guardo|preparo|divido'
const PRONOMBRE = '(?:(?:te|le)\\s+)?(?:lo|la|los|las)\\s+|(?:te|le)\\s+'
const OFRECE = new RegExp(`^¿\\s*(?:(?:${PRONOMBRE})(?:${YO})|quieres\\s+que\\s+(?:${PRONOMBRE})?(?:${QUE})|(?:${SOLOS}))(?=[\\s,?])`, 'iu')

// En inglés: «Shall I add it to level 1?», «Do you want me to move it?». Sin «¿»: la pregunta es la última frase.
const OFRECE_EN = /^(?:shall i|should i|do you want me to|would you like me to|want me to|can i|may i)\s+(?:add|put|move|insert|include|remove|delete|drop|reorder|reorganise|reorganize|rename|note|jot|save|mark|split|merge|prepare|set up|make)\b/i

function ofreceCambioEn(t: string): boolean {
  const cuerpo = t.slice(0, -1)
  const i = Math.max(cuerpo.lastIndexOf('. '), cuerpo.lastIndexOf('! '), cuerpo.lastIndexOf('? '), cuerpo.lastIndexOf('\n'))
  const pregunta = cuerpo.slice(i + 1).replace(/^[\s*_]+/, '')
  if (/\sor\s/i.test(pregunta)) return false
  return OFRECE_EN.test(pregunta)
}

export function ofreceCambio(texto: string): boolean {
  // Si trae el bloque `cambio`, ya lo está preparando: no hay nada que confirmar.
  if (texto.includes('```cambio')) return false
  const t = texto.replace(/```acciones[\s\S]*?(```|$)/g, '').replace(/[\s*_]+$/, '')
  if (!t.endsWith('?')) return false
  return ofreceCambioEs(t) || ofreceCambioEn(t)
}

function ofreceCambioEs(t: string): boolean {
  const i = t.lastIndexOf('¿')
  if (i < 0) return false
  const pregunta = t.slice(i)
  // Una sola pregunta, sin alternativas («¿Lo añado al nivel 1 o al 2?» no se contesta con un sí).
  if (pregunta.slice(0, -1).includes('?') || /\s[ou]\s/i.test(pregunta)) return false
  // Que empiece frase: «Si quieres, ¿lo añado?» no vale.
  if (!/(^|[.!?…:»)\n])[\s*_]*$/.test(t.slice(0, i))) return false
  return OFRECE.test(pregunta)
}
