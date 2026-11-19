// Proyectos: las referencias agrupadas por el bloque del nivel 1 que cubren, el título de un paso del diario (aunque
// ya no esté en el roadmap) y la idea que llega desde el plan. Lógica pura, con test en pruebas/referenciasProyecto.test.ts.

export interface Referencia {
  url: string
  titulo: string
  motivo: string
  // Número del bloque del nivel 1 que cubre (o null: un proyecto parecido). Las de antes no lo traen.
  bloque?: number | null
  bloque_id?: string | null
  ficha?: unknown
}

export interface GrupoReferencias {
  // null: las referencias de antes, sin bloque, en una sola lista sin título.
  titulo: string | null
  referencias: Referencia[]
}

export const PARECIDOS = 'Proyectos parecidos'

// Primero los proyectos parecidos y luego cada bloque en su orden; el título del bloque sale del roadmap (por su id) y,
// si ya no está, «Bloque n».
export function agruparReferencias(refs: Referencia[], bloquesNivel1: { id: string; titulo: string }[]): GrupoReferencias[] {
  if (!refs.some((r) => r.bloque !== undefined)) return refs.length ? [{ titulo: null, referencias: refs }] : []
  const parecidos = refs.filter((r) => r.bloque == null)
  const porBloque = new Map<number, Referencia[]>()
  for (const r of refs) if (r.bloque != null) porBloque.set(r.bloque, [...(porBloque.get(r.bloque) ?? []), r])
  const grupos: GrupoReferencias[] = parecidos.length ? [{ titulo: PARECIDOS, referencias: parecidos }] : []
  for (const [n, lista] of [...porBloque].sort((a, b) => a[0] - b[0])) {
    const id = lista.find((r) => r.bloque_id)?.bloque_id
    const b = bloquesNivel1.find((x) => x.id === id) ?? (id ? undefined : bloquesNivel1[n - 1])
    grupos.push({ titulo: b ? b.titulo : `Bloque ${n}`, referencias: lista })
  }
  return grupos
}

// El título del paso de una decisión: del roadmap y, si ya no está (se rehízo), de lo hecho que ya no está.
export function tituloDePaso(
  pid: string | null,
  pasos: { id: string; titulo: string }[],
  yaNoEstan: { id: string; titulo: string }[],
): { titulo: string; yaNoEsta: boolean } | null {
  if (!pid) return null
  const vivo = pasos.find((x) => x.id === pid)
  if (vivo) return { titulo: vivo.titulo, yaNoEsta: false }
  const ido = yaNoEstan.find((x) => x.id === pid)
  return ido ? { titulo: ido.titulo, yaNoEsta: true } : null
}

// «Llevar a Proyectos» (PanelPlan) deja aquí la idea; el formulario de proyecto nuevo la toma y la borra.
export const CLAVE_IDEA = 'magister-idea-proyecto'

export function leerIdea(almacen: Pick<Storage, 'getItem'> | undefined = globalThis.sessionStorage): string {
  try {
    return almacen?.getItem(CLAVE_IDEA) ?? ''
  } catch {
    return ''
  }
}

export function olvidarIdea(almacen: Pick<Storage, 'removeItem'> | undefined = globalThis.sessionStorage): void {
  try {
    almacen?.removeItem(CLAVE_IDEA)
  } catch {
    // sin almacenamiento (ventana privada), nada que borrar
  }
}
