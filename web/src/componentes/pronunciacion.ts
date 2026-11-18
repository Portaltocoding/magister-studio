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
  // Letra a letra, como se dice en español: «i de» (no «íd»).
  { escrito: 'id', se_dice: 'i de', grupo: 'Bases de datos', variantes: ['ID', 'Id'] },
  { escrito: 'IDs', se_dice: 'i des', grupo: 'Bases de datos', variantes: ['ids', 'Ids'] },
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
  { escrito: 'ORDER', se_dice: 'órder', grupo: 'Bases de datos' },
  { escrito: 'LIMIT', se_dice: 'límit', grupo: 'Bases de datos' },
  { escrito: 'HAVING', se_dice: 'jáving', grupo: 'Bases de datos' },
  { escrito: 'COMMIT', se_dice: 'comít', grupo: 'Bases de datos' },
  { escrito: 'ROLLBACK', se_dice: 'rólbak', grupo: 'Bases de datos' },
  { escrito: 'BEGIN', se_dice: 'biguín', grupo: 'Bases de datos' },
  { escrito: 'PRIMARY KEY', se_dice: 'práimari qui', grupo: 'Bases de datos' },
  { escrito: 'FOREIGN KEY', se_dice: 'fórin qui', grupo: 'Bases de datos' },
  { escrito: 'UNIQUE', se_dice: 'iuník', grupo: 'Bases de datos' },
  { escrito: 'READ UNCOMMITTED', se_dice: 'rid ancomíted', grupo: 'Bases de datos' },
  { escrito: 'READ COMMITTED', se_dice: 'rid comíted', grupo: 'Bases de datos' },
  { escrito: 'REPEATABLE READ', se_dice: 'ripítabol rid', grupo: 'Bases de datos' },
  { escrito: 'SERIALIZABLE', se_dice: 'serialáisabol', grupo: 'Bases de datos' },
  { escrito: 'upsert', se_dice: 'ápsert', grupo: 'Bases de datos', cualquier_caso: true },
  { escrito: 'sharding', se_dice: 'shárding', grupo: 'Bases de datos', cualquier_caso: true },
  { escrito: 'cache-aside', se_dice: 'cash asáid', grupo: 'Bases de datos', cualquier_caso: true },
  { escrito: 'Redis', se_dice: 'rédis', grupo: 'Bases de datos' },
  { escrito: 'pgvector', se_dice: 'pe ge véctor', grupo: 'Bases de datos' },
  { escrito: 'deadlock', se_dice: 'dédlok', grupo: 'Bases de datos', variantes: ['deadlocks'], cualquier_caso: true },

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
  { escrito: 'API', se_dice: 'a pe i', grupo: 'Web y APIs', variantes: ['APIs'] },
  { escrito: 'OpenAPI', se_dice: 'open a pe i', grupo: 'Web y APIs' },
  { escrito: 'HTTP/2', se_dice: 'hache te te pe dos', grupo: 'Web y APIs' },
  { escrito: 'HTTP/3', se_dice: 'hache te te pe tres', grupo: 'Web y APIs' },
  { escrito: 'OPTIONS', se_dice: 'ópshons', grupo: 'Web y APIs' },
  { escrito: 'OK', se_dice: 'oquéi', grupo: 'Web y APIs' },
  { escrito: 'ETag', se_dice: 'i tag', grupo: 'Web y APIs', variantes: ['ETags'] },
  { escrito: 'IP', se_dice: 'i pe', grupo: 'Web y APIs', variantes: ['IPs'] },
  { escrito: 'RTT', se_dice: 'erre te te', grupo: 'Web y APIs' },
  { escrito: 'SYN-ACK', se_dice: 'sin ac', grupo: 'Web y APIs' },
  { escrito: 'SYN', se_dice: 'sin', grupo: 'Web y APIs' },
  { escrito: 'ACK', se_dice: 'ac', grupo: 'Web y APIs' },
  { escrito: 'UDP', se_dice: 'u de pe', grupo: 'Web y APIs' },
  { escrito: 'QUIC', se_dice: 'cuic', grupo: 'Web y APIs' },
  { escrito: 'cookie', se_dice: 'cuki', grupo: 'Web y APIs', variantes: ['cookies'], cualquier_caso: true },
  { escrito: 'webhook', se_dice: 'uebjuk', grupo: 'Web y APIs', variantes: ['webhooks'], cualquier_caso: true },
  { escrito: 'middleware', se_dice: 'mídelguer', grupo: 'Web y APIs', cualquier_caso: true },
  { escrito: 'rate limiting', se_dice: 'reit límitin', grupo: 'Web y APIs', cualquier_caso: true },
  { escrito: 'WebSocket', se_dice: 'ueb sóquet', grupo: 'Web y APIs', variantes: ['WebSockets'], cualquier_caso: true },

  // ===== Seguridad =====
  { escrito: 'JWT', se_dice: 'jota uve te', grupo: 'Seguridad', variantes: ['JWTs'] },
  { escrito: 'XSS', se_dice: 'equis ese ese', grupo: 'Seguridad' },
  { escrito: 'CSRF', se_dice: 'ce ese erre efe', grupo: 'Seguridad' },
  { escrito: 'OAuth', se_dice: 'o auz', grupo: 'Seguridad' },
  { escrito: 'OIDC', se_dice: 'o i de ce', grupo: 'Seguridad' },
  { escrito: 'HttpOnly', se_dice: 'hache te te pe ónli', grupo: 'Seguridad' },
  { escrito: 'SameSite', se_dice: 'seim sait', grupo: 'Seguridad' },
  { escrito: 'RBAC', se_dice: 'erre be a ce', grupo: 'Seguridad' },
  { escrito: 'bcrypt', se_dice: 'be cript', grupo: 'Seguridad' },
  { escrito: 'hash', se_dice: 'jash', grupo: 'Seguridad', variantes: ['hashes'], cualquier_caso: true },
  { escrito: 'salt', se_dice: 'solt', grupo: 'Seguridad', cualquier_caso: true },
  { escrito: 'SSO', se_dice: 'ese ese o', grupo: 'Seguridad' },
  { escrito: 'MFA', se_dice: 'eme efe a', grupo: 'Seguridad' },
  { escrito: 'HMAC', se_dice: 'hache mac', grupo: 'Seguridad' },

  // ===== IA =====
  { escrito: 'LLM', se_dice: 'ele ele eme', grupo: 'IA', variantes: ['LLMs'] },
  { escrito: 'RAG', se_dice: 'rag', grupo: 'IA' },
  { escrito: 'RLHF', se_dice: 'erre ele hache efe', grupo: 'IA' },
  { escrito: 'top-p', se_dice: 'top pe', grupo: 'IA' },
  { escrito: 'F1', se_dice: 'efe uno', grupo: 'IA' },
  { escrito: 'GPU', se_dice: 'ge pe u', grupo: 'IA', variantes: ['GPUs'] },
  { escrito: 'CPU', se_dice: 'ce pe u', grupo: 'IA' },
  { escrito: 'AI', se_dice: 'ei ai', grupo: 'IA' },
  { escrito: 'ML', se_dice: 'eme ele', grupo: 'IA' },
  { escrito: 'GPT', se_dice: 'ge pe te', grupo: 'IA' },
  { escrito: 'OpenAI', se_dice: 'open ei ai', grupo: 'IA' },
  { escrito: 'Anthropic', se_dice: 'anzrópic', grupo: 'IA' },
  { escrito: 'Claude', se_dice: 'clod', grupo: 'IA' },
  { escrito: 'top-k', se_dice: 'top ca', grupo: 'IA' },
  { escrito: 'BM25', se_dice: 'be eme veinticinco', grupo: 'IA' },
  { escrito: 'HNSW', se_dice: 'hache ene ese uve doble', grupo: 'IA' },
  { escrito: 'LoRA', se_dice: 'lora', grupo: 'IA' },
  { escrito: 'fine-tuning', se_dice: 'fáin tiúning', grupo: 'IA', cualquier_caso: true },
  { escrito: 'few-shot', se_dice: 'fiú shot', grupo: 'IA', cualquier_caso: true },
  { escrito: 'zero-shot', se_dice: 'síro shot', grupo: 'IA', cualquier_caso: true },
  { escrito: 'chain-of-thought', se_dice: 'chein of zot', grupo: 'IA', cualquier_caso: true },
  { escrito: 'chunking', se_dice: 'chánkin', grupo: 'IA', cualquier_caso: true },
  { escrito: 'chunk', se_dice: 'chank', grupo: 'IA', variantes: ['chunks'], cualquier_caso: true },
  { escrito: 'reranking', se_dice: 'rirránkin', grupo: 'IA', cualquier_caso: true },
  { escrito: 'reranker', se_dice: 'rirránquer', grupo: 'IA', cualquier_caso: true },
  { escrito: 'embedding', se_dice: 'embéding', grupo: 'IA', variantes: ['embeddings'], cualquier_caso: true },
  { escrito: 'guardrails', se_dice: 'gard reils', grupo: 'IA', cualquier_caso: true },
  { escrito: 'pipeline', se_dice: 'páiplain', grupo: 'IA', variantes: ['pipelines'], cualquier_caso: true },
  { escrito: 'streaming', se_dice: 'estríming', grupo: 'IA', cualquier_caso: true },
  { escrito: 'dataset', se_dice: 'déitaset', grupo: 'IA', variantes: ['datasets'], cualquier_caso: true },
  { escrito: 'LangGraph', se_dice: 'lang graf', grupo: 'IA' },
  { escrito: 'LangChain', se_dice: 'lang chein', grupo: 'IA' },

  // ===== Algoritmos =====
  { escrito: 'BFS', se_dice: 'be efe ese', grupo: 'Algoritmos' },
  { escrito: 'DFS', se_dice: 'de efe ese', grupo: 'Algoritmos' },
  { escrito: 'DP', se_dice: 'de pe', grupo: 'Algoritmos' },
  { escrito: 'NaN', se_dice: 'nan', grupo: 'Algoritmos' },
  { escrito: 'hash map', se_dice: 'jash map', grupo: 'Algoritmos', variantes: ['hashmap', 'hash maps'], cualquier_caso: true },
  { escrito: 'heap', se_dice: 'jip', grupo: 'Algoritmos', cualquier_caso: true },
  { escrito: 'queue', se_dice: 'kiú', grupo: 'Algoritmos', cualquier_caso: true },
  { escrito: 'thread', se_dice: 'zred', grupo: 'Algoritmos', variantes: ['threads'], cualquier_caso: true },
  { escrito: 'mutex', se_dice: 'miútex', grupo: 'Algoritmos', cualquier_caso: true },
  { escrito: 'race condition', se_dice: 'reis condíshon', grupo: 'Algoritmos', variantes: ['race conditions'], cualquier_caso: true },

  // ===== Frontend =====
  { escrito: 'JS', se_dice: 'yei es', grupo: 'Frontend' },
  { escrito: 'TS', se_dice: 'te es', grupo: 'Frontend' },
  { escrito: 'TDZ', se_dice: 'te de zeta', grupo: 'Frontend' },
  { escrito: 'Node.js', se_dice: 'noud yei es', grupo: 'Frontend', variantes: ['NodeJS', 'Node'] },
  { escrito: 'Next.js', se_dice: 'next yei es', grupo: 'Frontend' },
  { escrito: 'Vite', se_dice: 'vit', grupo: 'Frontend' },
  { escrito: 'hook', se_dice: 'juk', grupo: 'Frontend', variantes: ['hooks'], cualquier_caso: true },
  { escrito: 'useState', se_dice: 'iús steit', grupo: 'Frontend' },
  { escrito: 'useEffect', se_dice: 'iús iféct', grupo: 'Frontend' },
  { escrito: 'useMemo', se_dice: 'iús memo', grupo: 'Frontend' },
  { escrito: 'useRef', se_dice: 'iús ref', grupo: 'Frontend' },
  { escrito: 'props', se_dice: 'props', grupo: 'Frontend' },
  { escrito: 'async/await', se_dice: 'asínc auéit', grupo: 'Frontend', cualquier_caso: true },
  { escrito: 'async', se_dice: 'asínc', grupo: 'Frontend', cualquier_caso: true },
  { escrito: 'await', se_dice: 'auéit', grupo: 'Frontend', cualquier_caso: true },
  { escrito: 'Promise', se_dice: 'prómis', grupo: 'Frontend', variantes: ['Promises'] },
  { escrito: 'callback', se_dice: 'cólbak', grupo: 'Frontend', variantes: ['callbacks'], cualquier_caso: true },
  { escrito: 'event loop', se_dice: 'ivent lup', grupo: 'Frontend', cualquier_caso: true },
  { escrito: 'hydration', se_dice: 'jaidréishon', grupo: 'Frontend', cualquier_caso: true },
  { escrito: 'lazy loading', se_dice: 'léisi lóudin', grupo: 'Frontend', cualquier_caso: true },
  { escrito: 'code splitting', se_dice: 'coud splítin', grupo: 'Frontend', cualquier_caso: true },
  { escrito: 'debounce', se_dice: 'dibáuns', grupo: 'Frontend', cualquier_caso: true },
  { escrito: 'Core Web Vitals', se_dice: 'cor ueb váitals', grupo: 'Frontend' },
  { escrito: 'LCP', se_dice: 'ele ce pe', grupo: 'Frontend' },
  { escrito: 'INP', se_dice: 'i ene pe', grupo: 'Frontend' },
  { escrito: 'CLS', se_dice: 'ce ele ese', grupo: 'Frontend' },
  { escrito: 'SPA', se_dice: 'ese pe a', grupo: 'Frontend' },

  // ===== Herramientas =====
  { escrito: 'CI/CD', se_dice: 'ce i ce de', grupo: 'Herramientas' },
  { escrito: 'npm', se_dice: 'ene pe eme', grupo: 'Herramientas' },
  { escrito: 'Docker', se_dice: 'dóquer', grupo: 'Herramientas' },
  { escrito: 'TypeScript', se_dice: 'taipscript', grupo: 'Herramientas' },
  { escrito: 'JavaScript', se_dice: 'yavascript', grupo: 'Herramientas' },
  { escrito: 'React', se_dice: 'riact', grupo: 'Herramientas' },
  { escrito: 'Git', se_dice: 'guit', grupo: 'Herramientas' },
  { escrito: 'GitHub', se_dice: 'guit jab', grupo: 'Herramientas' },
  { escrito: 'Kubernetes', se_dice: 'cubernétis', grupo: 'Herramientas' },
  { escrito: 'Kafka', se_dice: 'cafca', grupo: 'Herramientas' },
  { escrito: 'OpenTelemetry', se_dice: 'open telémetri', grupo: 'Herramientas' },
  { escrito: 'FastAPI', se_dice: 'fast a pe i', grupo: 'Herramientas' },
  { escrito: 'Python', se_dice: 'páizon', grupo: 'Herramientas' },
  { escrito: 'SaaS', se_dice: 'sas', grupo: 'Herramientas' },
  { escrito: 'deploy', se_dice: 'diplói', grupo: 'Herramientas', cualquier_caso: true },
  { escrito: 'rollback', se_dice: 'rólbak', grupo: 'Herramientas', cualquier_caso: true },
  { escrito: 'blue-green', se_dice: 'blu grin', grupo: 'Herramientas', cualquier_caso: true },
  { escrito: 'canary', se_dice: 'canari', grupo: 'Herramientas', cualquier_caso: true },
  { escrito: 'load balancer', se_dice: 'loud bálanser', grupo: 'Herramientas', cualquier_caso: true },
  { escrito: 'framework', se_dice: 'fréimuork', grupo: 'Herramientas', variantes: ['frameworks'], cualquier_caso: true },
  { escrito: 'STAR', se_dice: 'estar', grupo: 'Herramientas' },

  // ===== Ciencias e ingeniería =====
  { escrito: 'Bowditch', se_dice: 'báudich', grupo: 'Ciencias e ingeniería' },
  { escrito: 'GRAD', se_dice: 'grad', grupo: 'Ciencias e ingeniería' },

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
