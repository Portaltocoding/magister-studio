// El glosario de pronunciación: cómo dice la voz cada término técnico que, escrito, una voz española leería mal
// (las siglas y lo que va en mayúsculas lo deletrea: «id» sale «i de», «LIKE» sale «ele i ka e»).
// Una entrada por término; se busca en el Taller → Pronunciación, donde también se escucha.
//
// Cómo se aplica (ver `aplicarGlosario`):
// - Se busca tal cual está escrito (mayúsculas incluidas), salvo `cualquier_caso`.
// - Como palabra entera, con límites que entienden las tildes (no toca «idénticas» por «id»).
// - Los términos largos antes que sus trozos («Bitmap Index Scan» antes que «Index Scan»).
// - Una entrada que acaba en «_» es un prefijo («idx_pedidos» → «índex pedidos»).
// Solo cambia lo que se oye: el subtítulo y la pantalla siguen con el texto escrito.

export interface Termino {
  escrito: string
  se_dice: string
  grupo: string
  // Otras formas que suenan igual (plural, mayúsculas).
  variantes?: string[]
  cualquier_caso?: boolean
  // Puede ir pegado a un número («90ms»), como las unidades.
  tras_numero?: boolean
}

export const GLOSARIO: Termino[] = [
  // ===== Bases de datos =====
  { escrito: 'SQL', se_dice: 'ese cu ele', grupo: 'Bases de datos' },
  { escrito: 'NoSQL', se_dice: 'no ese cu ele', grupo: 'Bases de datos' },
  { escrito: 'id', se_dice: 'íd', grupo: 'Bases de datos', variantes: ['ID', 'IDs', 'ids'] },
  { escrito: 'SELECT', se_dice: 'select', grupo: 'Bases de datos' },
  { escrito: 'INSERT', se_dice: 'insert', grupo: 'Bases de datos' },
  { escrito: 'UPDATE', se_dice: 'ápdeit', grupo: 'Bases de datos' },
  { escrito: 'DELETE', se_dice: 'dilít', grupo: 'Bases de datos' },
  { escrito: 'WHERE', se_dice: 'güer', grupo: 'Bases de datos' },
  { escrito: 'FROM', se_dice: 'from', grupo: 'Bases de datos' },
  { escrito: 'JOIN', se_dice: 'yoin', grupo: 'Bases de datos', variantes: ['JOINs', 'joins'] },
  { escrito: 'LIKE', se_dice: 'laik', grupo: 'Bases de datos' },
  { escrito: 'GROUP BY', se_dice: 'grup bai', grupo: 'Bases de datos' },
  { escrito: 'ORDER BY', se_dice: 'órder bai', grupo: 'Bases de datos' },
  { escrito: 'CREATE INDEX', se_dice: 'crieit índex', grupo: 'Bases de datos' },
  { escrito: 'EXPLAIN ANALYZE', se_dice: 'explein análaiz', grupo: 'Bases de datos' },
  { escrito: 'EXPLAIN', se_dice: 'explein', grupo: 'Bases de datos' },
  { escrito: 'Seq Scan', se_dice: 'sic scan', grupo: 'Bases de datos' },
  { escrito: 'Index Scan', se_dice: 'índex scan', grupo: 'Bases de datos' },
  { escrito: 'Bitmap Index Scan', se_dice: 'bítmap índex scan', grupo: 'Bases de datos' },
  { escrito: 'Bitmap Heap Scan', se_dice: 'bítmap jip scan', grupo: 'Bases de datos' },
  { escrito: 'B-tree', se_dice: 'árbol be', grupo: 'Bases de datos', variantes: ['Btree'], cualquier_caso: true },
  { escrito: 'Postgres', se_dice: 'póstgres', grupo: 'Bases de datos', variantes: ['PostgreSQL'] },
  { escrito: 'pg_trgm', se_dice: 'pe ge trigramas', grupo: 'Bases de datos' },
  { escrito: 'idx_', se_dice: 'índex ', grupo: 'Bases de datos' },
  { escrito: 'lower(', se_dice: 'lóuer(', grupo: 'Bases de datos' },
  { escrito: 'ACID', se_dice: 'ácid', grupo: 'Bases de datos' },
  { escrito: 'CAP', se_dice: 'cap', grupo: 'Bases de datos' },

  // ===== Web y APIs =====
  { escrito: 'HTTP', se_dice: 'hache te te pe', grupo: 'Web y APIs' },
  { escrito: 'HTTPS', se_dice: 'hache te te pe ese', grupo: 'Web y APIs' },
  { escrito: 'GET', se_dice: 'guet', grupo: 'Web y APIs' },
  { escrito: 'POST', se_dice: 'post', grupo: 'Web y APIs' },
  { escrito: 'PUT', se_dice: 'put', grupo: 'Web y APIs' },
  { escrito: 'PATCH', se_dice: 'pach', grupo: 'Web y APIs' },
  { escrito: 'REST', se_dice: 'rest', grupo: 'Web y APIs' },
  { escrito: 'GraphQL', se_dice: 'graf cu ele', grupo: 'Web y APIs' },
  { escrito: 'gRPC', se_dice: 'ge erre pe ce', grupo: 'Web y APIs' },
  { escrito: 'JSON', se_dice: 'yeison', grupo: 'Web y APIs' },
  { escrito: 'URL', se_dice: 'u erre ele', grupo: 'Web y APIs', variantes: ['URLs'] },
  { escrito: 'UUID', se_dice: 'u u i de', grupo: 'Web y APIs', variantes: ['UUIDs'] },
  { escrito: 'RFC', se_dice: 'erre efe ce', grupo: 'Web y APIs' },
  { escrito: 'Idempotency-Key', se_dice: 'idempótensi qui', grupo: 'Web y APIs' },
  { escrito: 'CORS', se_dice: 'cors', grupo: 'Web y APIs' },
  { escrito: 'CDN', se_dice: 'ce de ene', grupo: 'Web y APIs' },
  { escrito: 'DNS', se_dice: 'de ene ese', grupo: 'Web y APIs' },
  { escrito: 'TCP', se_dice: 'te ce pe', grupo: 'Web y APIs' },
  { escrito: 'TLS', se_dice: 'te ele ese', grupo: 'Web y APIs' },
  { escrito: 'SSR', se_dice: 'ese ese erre', grupo: 'Web y APIs' },
  { escrito: 'SSG', se_dice: 'ese ese ge', grupo: 'Web y APIs' },
  { escrito: 'CSR', se_dice: 'ce ese erre', grupo: 'Web y APIs' },
  { escrito: 'HTML', se_dice: 'hache te eme ele', grupo: 'Web y APIs' },
  { escrito: 'CSS', se_dice: 'ce ese ese', grupo: 'Web y APIs' },
  { escrito: 'DOM', se_dice: 'dom', grupo: 'Web y APIs' },
  { escrito: 'ARIA', se_dice: 'aria', grupo: 'Web y APIs' },

  // ===== Seguridad =====
  { escrito: 'JWT', se_dice: 'jota uve te', grupo: 'Seguridad', variantes: ['JWTs'] },
  { escrito: 'XSS', se_dice: 'equis ese ese', grupo: 'Seguridad' },
  { escrito: 'CSRF', se_dice: 'ce ese erre efe', grupo: 'Seguridad' },
  { escrito: 'OAuth', se_dice: 'o auz', grupo: 'Seguridad' },
  { escrito: 'OIDC', se_dice: 'o i de ce', grupo: 'Seguridad' },

  // ===== IA =====
  { escrito: 'LLM', se_dice: 'ele ele eme', grupo: 'IA', variantes: ['LLMs'] },
  { escrito: 'RAG', se_dice: 'rag', grupo: 'IA' },
  { escrito: 'RLHF', se_dice: 'erre ele hache efe', grupo: 'IA' },
  { escrito: 'top-p', se_dice: 'top pe', grupo: 'IA' },
  { escrito: 'F1', se_dice: 'efe uno', grupo: 'IA' },
  { escrito: 'GPU', se_dice: 'ge pe u', grupo: 'IA', variantes: ['GPUs'] },
  { escrito: 'CPU', se_dice: 'ce pe u', grupo: 'IA' },

  // ===== Herramientas =====
  { escrito: 'CI/CD', se_dice: 'ce i ce de', grupo: 'Herramientas' },
  { escrito: 'npm', se_dice: 'ene pe eme', grupo: 'Herramientas' },
  { escrito: 'Docker', se_dice: 'dóquer', grupo: 'Herramientas' },
  { escrito: 'TypeScript', se_dice: 'taipscript', grupo: 'Herramientas' },
  { escrito: 'JavaScript', se_dice: 'yavascript', grupo: 'Herramientas' },
  { escrito: 'React', se_dice: 'riact', grupo: 'Herramientas' },

  // ===== Unidades =====
  { escrito: 'ms', se_dice: 'milisegundos', grupo: 'Unidades', tras_numero: true },
  { escrito: 'MB', se_dice: 'megas', grupo: 'Unidades', tras_numero: true },
  { escrito: 'GB', se_dice: 'gigas', grupo: 'Unidades', tras_numero: true },
  { escrito: 'KB', se_dice: 'kilobytes', grupo: 'Unidades', tras_numero: true },
]

// Solo lo que es sintaxis: con la bandera `u`, escapar de más («\-», «\/») es un error y rompería la voz entera.
const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const esLetra = (c: string) => /[\p{L}\d]/u.test(c)

// Una expresión por término (y sus variantes), con los límites que tocan.
function patron(t: Termino): RegExp {
  const formas = [t.escrito, ...(t.variantes ?? [])].sort((a, b) => b.length - a.length)
  const partes = formas.map((f) => {
    const antes = !esLetra(f[0]) ? '' : t.tras_numero ? '(?<![\\p{L}_])' : '(?<![\\p{L}\\d_])'
    const despues = esLetra(f[f.length - 1]) ? '(?![\\p{L}\\d])' : ''
    return antes + escapar(f) + despues
  })
  return new RegExp(partes.join('|'), t.cualquier_caso ? 'giu' : 'gu')
}

// Los términos largos primero: «Bitmap Index Scan» no debe convertirse antes en «Bitmap índex scan».
const ORDENADO = [...GLOSARIO].sort((a, b) => b.escrito.length - a.escrito.length).map((t) => [patron(t), t.se_dice] as const)

export function aplicarGlosario(texto: string): string {
  let t = texto
  for (const [p, dicho] of ORDENADO) t = t.replace(p, () => dicho)
  return t
}

// Para buscar en el Taller: por cómo se escribe, cómo se dice o su grupo, sin tildes ni mayúsculas.
const normal = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
export function buscarTerminos(consulta: string): Termino[] {
  const q = normal(consulta.trim())
  if (!q) return GLOSARIO
  return GLOSARIO.filter((t) => [t.escrito, t.se_dice, t.grupo, ...(t.variantes ?? [])].some((c) => normal(c).includes(q)))
}
