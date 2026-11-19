// Las preguntas frecuentes del asesor: se contestan al instante, en la propia pantalla, sin llamar al modelo.
// Cada una dice en qué secciones sale primero («*», en todas) y sus palabras clave para reconocerla aunque la escribas
// a tu manera. La respuesta es Markdown y puede acabar en un bloque `acciones` («Texto | #/ruta») con botones para ir.
// Si algo de la app cambia, se cambia aquí: el asesor contesta con lo que pone.

export interface Faq {
  id: string
  pregunta: string
  respuesta: string
  secciones: string[]
  claves: string[]
}

const ir = (texto: string, ruta: string) => `\n\n\`\`\`acciones\n${texto} | ${ruta}\n\`\`\``

export const FAQS: Faq[] = [
  {
    id: 'plan',
    pregunta: '¿Cómo creo un plan de estudio?',
    respuesta:
      'En **Plan → Roadmap**, pulsa **«Nuevo plan»**, o pídelo en Estudio libre («hazme un plan de…»). Te pregunta qué quieres aprender, para qué, qué sabes, tus horas y tu plazo, y te propone las lecciones y el calendario. Lo aceptas o pides cambios.' +
      ir('Ir al Roadmap', '#/roadmap'),
    secciones: ['roadmap', 'hoy', 'libre', 'calendario'],
    claves: ['plan', 'crear', 'nuevo', 'roadmap', 'estudio', 'empezar'],
  },
  {
    id: 'atrasado',
    pregunta: 'Me he atrasado, ¿cómo reajusto el plan?',
    respuesta:
      'En **Roadmap**: **«Me he atrasado»** recalcula el calendario desde hoy, y **«Reajustar con mis repasos»** lo rehace según lo que ya dominas.' +
      ir('Ir al Roadmap', '#/roadmap'),
    secciones: ['roadmap', 'hoy', 'calendario'],
    claves: ['atrasado', 'retraso', 'reajustar', 'recalcular', 'calendario', 'plan', 'tarde'],
  },
  {
    id: 'hoy',
    pregunta: '¿Qué me toca hoy?',
    respuesta:
      'En **Hoy** tienes los repasos pendientes, la lección que toca según tu calendario y los exámenes cercanos. **«Empezar en modo foco»** te lleva por la lección idea a idea.' +
      ir('Ir a Hoy', '#/hoy'),
    secciones: ['*'],
    claves: ['hoy', 'toca', 'hacer', 'ahora', 'siguiente', 'pendiente'],
  },
  {
    id: 'material',
    pregunta: '¿Cómo preparo el material de una lección?',
    respuesta:
      'En **Lecciones**, elige la lección y pulsa **«Generar el material»**: apuntes en PDF, fichas de repaso y preguntas. Antes de aceptar ves cuánto gastará de tu sesión. Las diapositivas y el vídeo se piden aparte.' +
      ir('Ir a Lecciones', '#/fichas'),
    secciones: ['fichas', 'hoy', 'roadmap'],
    claves: ['material', 'apuntes', 'fichas', 'generar', 'preparar', 'leccion', 'pdf'],
  },
  {
    id: 'video',
    pregunta: '¿Cómo hago un vídeo de una lección?',
    respuesta:
      'En **Lecciones → Vídeos**, **«Nuevo vídeo»**: eliges la lección (o un solo concepto), el estilo y la duración (3, 6 o 10 minutos). Las barras te dicen cuánto gastará antes de hacerlo.' +
      ir('Ir a Vídeos', '#/video'),
    secciones: ['video', 'fichas'],
    claves: ['video', 'videos', 'hacer', 'crear', 'animado', 'guion'],
  },
  {
    id: 'barras',
    pregunta: '¿Qué son las barras de sesión y semana?',
    respuesta:
      'Es tu uso de la suscripción: **sesión** es la ventana de 5 horas y **semana**, la de 7 días. Lo rayado es lo que gastaría lo que vas a generar. Si se llenan, toca esperar a que se renueven (pone a qué hora).',
    secciones: ['*'],
    claves: ['barra', 'barras', 'sesion', 'semana', 'uso', 'cuota', 'gasto', 'gastar', 'limite', 'rayado'],
  },
  {
    id: 'repaso',
    pregunta: '¿Cómo repaso?',
    respuesta:
      'En **Practicar → Repaso** respondes de memoria lo que toca hoy, dices cómo de seguro estás y el tutor corrige y explica el fallo. Si no estás de acuerdo con la nota, puedes discutirla.' +
      ir('Ir a Repaso', '#/repaso'),
    secciones: ['repaso', 'hoy', 'examen'],
    claves: ['repaso', 'repasar', 'repasos', 'memoria', 'olvido', 'recordar'],
  },
  {
    id: 'examen',
    pregunta: '¿Cómo hago un examen?',
    respuesta: 'En **Practicar → Examen**: preguntas de las lecciones que llevas, con nota al final y la corrección explicada.' + ir('Ir a Examen', '#/examen'),
    secciones: ['examen', 'repaso', 'hoy'],
    claves: ['examen', 'nota', 'prueba', 'ponerme', 'evaluar', 'parcial'],
  },
  {
    id: 'fuentes',
    pregunta: '¿Cómo subo mis apuntes o un PDF?',
    respuesta:
      'En **Biblioteca → Tus fuentes**: crea una fuente y sube PDF, Markdown, HTML o una dirección web. Desde ahí el tutor responde citándolas (pulsa el número de la cita para ver el trozo).' +
      ir('Ir a Tus fuentes', '#/temas'),
    secciones: ['temas', 'libre', 'buscar', 'web'],
    claves: ['subir', 'pdf', 'apuntes', 'fuente', 'fuentes', 'documento', 'libro', 'archivo'],
  },
  {
    id: 'buscar',
    pregunta: '¿Cómo busco fuentes en la web para una lección?',
    respuesta:
      'En **Biblioteca → Buscar fuentes**: rastrea la web para un tema o una lección y te propone fuentes. Tú apruebas cuáles se usan.' + ir('Ir a Buscar fuentes', '#/buscar'),
    secciones: ['buscar', 'temas', 'fichas'],
    claves: ['buscar', 'web', 'internet', 'fuentes', 'encontrar', 'investigar'],
  },
  {
    id: 'notas',
    pregunta: '¿Dónde están mis notas guardadas?',
    respuesta:
      'En **Biblioteca → Mis notas**. Se guardan desde Estudio libre con **«Guardar»** bajo una respuesta, marcando un trozo o diciéndole «guárdalo».' + ir('Ir a Mis notas', '#/notas'),
    secciones: ['notas', 'libre'],
    claves: ['notas', 'guardar', 'guardado', 'guardadas', 'apuntar'],
  },
  {
    id: 'afinar',
    pregunta: '¿Cómo cambio cómo me explica?',
    respuesta:
      'Pulsa **la mascota de la barra de arriba** (Afina a tu tutor): longitud, nivel, estilo (directo, con analogías o con código), diagramas y tests. También se lo puedes decir en el chat: «a partir de ahora…».',
    secciones: ['*'],
    claves: ['cambiar', 'explica', 'explicar', 'estilo', 'nivel', 'largo', 'corto', 'afinar', 'preferencias'],
  },
  {
    id: 'aprendido',
    pregunta: '¿Para qué sirve decir por qué no me sirve una respuesta?',
    respuesta:
      'Con **«No me sirve»** y su motivo (muy largo, le falta un ejemplo…), Magister aprende tu forma de estudiar: lo que repites se vuelve una regla y revisa cada vez menos, así que gasta menos. Lo ves en **Afinar → «Lo que ha aprendido de tus valoraciones»**.',
    secciones: ['libre', '*'],
    claves: ['sirve', 'valorar', 'valoracion', 'motivo', 'aprende', 'aprendido', 'pulgar'],
  },
  {
    id: 'charla',
    pregunta: '¿Puedo hablar con el tutor por voz?',
    respuesta:
      'Sí: en **Practicar → Charla** tienes una llamada con el tutor (clase, examen oral, entrevista o charla), con pizarra y notas.' + ir('Ir a Charla', '#/llamada'),
    secciones: ['llamada', 'hoy', 'repaso'],
    claves: ['voz', 'hablar', 'llamada', 'charla', 'oral', 'microfono'],
  },
  {
    id: 'foco',
    pregunta: '¿Qué es el modo foco?',
    respuesta:
      'Estudias una lección a pantalla completa, idea a idea, con una comprobación al final de cada una. Lleva un reloj de 25 minutos y sales con Esc; guarda dónde lo dejas.' + ir('Ir al modo foco', '#/foco'),
    secciones: ['foco', 'hoy', 'fichas'],
    claves: ['foco', 'concentrar', 'pantalla', 'completa', 'estudiar', 'leccion'],
  },
  {
    id: 'progreso',
    pregunta: '¿Dónde veo cómo voy?',
    respuesta:
      'En **Plan → Progreso**: el camino, los conceptos que dominas, tu racha, la carga de los próximos días y lo bien que calibras lo que sabes.' + ir('Ir a Progreso', '#/progreso'),
    secciones: ['progreso', 'hoy', 'roadmap'],
    claves: ['progreso', 'voy', 'avance', 'racha', 'dominio', 'estadisticas'],
  },
  {
    id: 'automatizar',
    pregunta: '¿Qué hace Automatizar?',
    respuesta:
      'Son reglas que Magister cumple solo: preparar la siguiente lección unos días antes, hacer sus diapositivas o su vídeo y, si quieres, solo de noche.' + ir('Ir a Automatizar', '#/automatizar'),
    secciones: ['automatizar', 'roadmap'],
    claves: ['automatizar', 'automatico', 'solo', 'noche', 'reglas'],
  },
  {
    id: 'no_cuenta',
    pregunta: '¿Lo que pruebo en Estudio libre cuenta para mi perfil?',
    respuesta: 'Si marcas **«Esto no cuenta»**, lo que preguntes ahí no cambia tu perfil ni tus repasos.',
    secciones: ['libre'],
    claves: ['cuenta', 'perfil', 'probar', 'prueba', 'estudio', 'libre'],
  },
  {
    id: 'mascota',
    pregunta: '¿Cómo devuelvo la mascota a su sitio?',
    respuesta: 'Arrástrala cerca de su sitio en la barra de arriba: el imán la atrae y, al soltarla, vuelve. También con doble clic sobre ella.',
    secciones: ['*'],
    claves: ['mascota', 'devolver', 'quitar', 'sitio', 'mover', 'asesor', 'barra'],
  },
]

// ===== Reconocer una pregunta escrita a tu manera =====

const VACIAS = new Set(
  'a al algo como con cual cuando de del donde el en es esta este esto la las le lo los me mi mis o para por que se si su sus te tu un una y yo hay hago puedo quiero ver'.split(
    ' ',
  ),
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
  for (const faq of FAQS) {
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
  const propias = FAQS.filter((f) => f.secciones.includes(seccion))
  const generales = FAQS.filter((f) => f.secciones.includes('*') && !propias.includes(f))
  return [...propias, ...generales]
}

// ===== Lo que el chat vacío te sugiere =====

const EXPLICAME = 'Explícame esta pantalla'
// En un proyecto abierto, el asesor puede cambiarlo: las sugerencias lo enseñan pidiéndole un cambio de verdad.
export const SUGERENCIAS_PROYECTO = [EXPLICAME, '¿Qué pasos le faltan a este roadmap?', 'Reorganiza este nivel para que tenga más sentido']

// En las pantallas del plan, con un plan activo, el asesor puede cambiarlo (mover una sesión, marcar una lección,
// preparar sus apuntes): las sugerencias lo enseñan pidiéndole un cambio de verdad.
export const SUGERENCIAS_PLAN: Record<string, string[]> = {
  hoy: [EXPLICAME, 'Mueve la sesión de hoy a mañana', 'Marca esta lección como hecha'],
  calendario: [EXPLICAME, 'Mueve la sesión de hoy a mañana', 'Apúntame un examen el viernes'],
  roadmap: [EXPLICAME, 'Mueve la sesión de hoy a mañana', 'Deja listos los apuntes de la próxima lección'],
  fichas: [EXPLICAME, 'Marca esta lección como hecha', 'Mueve la sesión de hoy a mañana'],
}
export const esPantallaDePlan = (seccion: string) => seccion.split('/')[0] in SUGERENCIAS_PLAN

// Las tres sugerencias del chat vacío. `seccion` es la clave de la ruta ('repaso', 'proyectos/12'…); `hayPlan`, si
// tienes un plan activo.
export function sugerenciasDe(seccion: string, enProyecto: boolean, hayPlan = false): string[] {
  if (enProyecto) return [...SUGERENCIAS_PROYECTO]
  if (hayPlan && esPantallaDePlan(seccion)) return [...SUGERENCIAS_PLAN[seccion.split('/')[0]]]
  const otras = faqsDe(seccion.split('/')[0]).map((f) => f.pregunta)
  return [...new Set([EXPLICAME, ...otras])].slice(0, 3)
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

export function ofreceCambio(texto: string): boolean {
  // Si trae el bloque `cambio`, ya lo está preparando: no hay nada que confirmar.
  if (texto.includes('```cambio')) return false
  const t = texto.replace(/```acciones[\s\S]*?(```|$)/g, '').replace(/[\s*_]+$/, '')
  if (!t.endsWith('?')) return false
  const i = t.lastIndexOf('¿')
  if (i < 0) return false
  const pregunta = t.slice(i)
  // Una sola pregunta, sin alternativas («¿Lo añado al nivel 1 o al 2?» no se contesta con un sí).
  if (pregunta.slice(0, -1).includes('?') || /\s[ou]\s/i.test(pregunta)) return false
  // Que empiece frase: «Si quieres, ¿lo añado?» no vale.
  if (!/(^|[.!?…:»)\n])[\s*_]*$/.test(t.slice(0, i))) return false
  return OFRECE.test(pregunta)
}
