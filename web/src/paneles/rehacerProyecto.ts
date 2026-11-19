// Rehacer el roadmap de un proyecto sin perder lo hecho: qué se le cuenta antes (para confirmarlo) y después. Y qué
// dice la pantalla mientras su trabajo espera en la cola o corre.
// Lógica pura, con test en pruebas/rehacerProyecto.test.ts.

export interface HechoQueYaNoEsta {
  id: string
  titulo: string
  hecho_en: string | null
}

const pasosHechos = (n: number) => (n === 1 ? '1 paso hecho' : `${n} pasos hechos`)

// Lo que pasa al rehacer, antes de confirmarlo. `hechos`: los pasos hechos que hay ahora en el roadmap.
export function avisoRehacer(hechos: number): string {
  const conservar =
    hechos > 0
      ? `Tienes ${pasosHechos(hechos)}: se intentarán conservar los que sigan existiendo en el roadmap nuevo, y lo hecho de los que no se apunta aparte.`
      : 'Aún no tienes pasos hechos.'
  return `${conservar} El roadmap de ahora se guarda para poder volver a él.`
}

// Un nivel se puede detallar si aún no lo está o si le quedan bloques sin pasos (un roadmap rehecho que conservó los
// pasos de unos bloques y trajo otros nuevos): detallarlo rellena solo esos, sin tocar los demás.
export function porDetallar(n: { detallado: boolean; bloques: { pasos: unknown[] }[] }): boolean {
  return !n.detallado || n.bloques.some((b) => b.pasos.length === 0)
}

// Los pasos hechos que el último rehacer no pudo conservar, con su título (de «ya_no_estan»). `noConservados`: sus
// ids, como los manda el servidor (los roadmaps rehechos antes no lo traen: entonces, ninguno).
export function perdidosAlRehacer(noConservados: string[] | undefined, yaNoEstan: HechoQueYaNoEsta[]): HechoQueYaNoEsta[] {
  const porId = new Map(yaNoEstan.map((x) => [x.id, x]))
  return (noConservados ?? []).map((id) => porId.get(id)).filter((x): x is HechoQueYaNoEsta => !!x)
}

// Lo que pasó al rehacer, en una frase (null si este roadmap no viene de rehacer otro). Con `noConservados`, cuántos
// de tus pasos hechos se han conservado y cuáles no.
export function resumenRehecho(conservados: number | undefined, yaNoEstan: HechoQueYaNoEsta[], noConservados?: string[]): string | null {
  if (conservados == null && yaNoEstan.length === 0) return null
  const perdidos = perdidosAlRehacer(noConservados, yaNoEstan)
  if (conservados != null && noConservados) {
    const total = conservados + perdidos.length
    if (total === 0) return 'No tenías pasos hechos: no había nada que conservar.'
    const lista = perdidos.map((x) => `«${x.titulo}»`).join(', ')
    if (!perdidos.length) return total === 1 ? 'Se ha conservado tu paso hecho.' : `Se han conservado los ${total} pasos hechos.`
    const cuantos =
      conservados === 0
        ? total === 1
          ? 'No se ha conservado tu paso hecho'
          : `No se ha conservado ninguno de tus ${pasosHechos(total)}`
        : `Se ${conservados === 1 ? 'ha' : 'han'} conservado ${conservados} de tus ${pasosHechos(total)}`
    return `${cuantos}. ${perdidos.length === 1 ? 'No sigue' : 'No siguen'} en el roadmap nuevo: ${lista} (lo hecho queda apuntado abajo).`
  }
  const partes: string[] = []
  if (conservados != null) partes.push(conservados > 0 ? `Se han conservado ${pasosHechos(conservados)}.` : 'No se ha conservado ningún paso hecho.')
  if (yaNoEstan.length > 0)
    partes.push(
      yaNoEstan.length === 1
        ? 'Uno que tenías hecho ya no está en el roadmap: lo tienes apuntado abajo.'
        : `${yaNoEstan.length} que tenías hechos ya no están en el roadmap: los tienes apuntados abajo.`,
    )
  return partes.join(' ')
}

// ---- El trabajo del proyecto: en cola o corriendo ----

export interface TrabajoProyecto {
  id: number
  estado: string
  nodo: string | null
  tipo?: string | null // proyecto_roadmap | proyecto_nivel
  nivel?: number | null // el nivel que detalla
  cola?: { por_delante: number; en_marcha: number; a_la_vez: number; reintento_desde?: string | null } | null
  trabajador_vivo?: boolean
}

const FASES: Record<string, string> = {
  referencias: 'Buscando proyectos y documentación parecidos…',
  roadmap: 'Escribiendo el roadmap: niveles, bloques y pasos…',
  arquitectura: 'Dibujando la arquitectura…',
}

// Qué está haciendo, en palabras: rehacer no es «detallar el nivel».
export function queHace(t: TrabajoProyecto | null | undefined, hayRoadmap: boolean): string {
  if (t?.tipo === 'proyecto_nivel') return t.nivel != null ? `Detallando el nivel ${t.nivel}…` : 'Detallando el nivel…'
  const fase = FASES[t?.nodo ?? '']
  if (fase) return hayRoadmap && t?.nodo === 'roadmap' ? 'Rehaciendo el roadmap: niveles, bloques y pasos…' : fase
  return hayRoadmap ? 'Rehaciendo el roadmap…' : 'Preparando el roadmap…'
}

// Lo que dice mientras espera en la cola: para qué, cuántos tiene delante y que el proyecto se sigue usando.
export function textoEnCola(t: TrabajoProyecto | null | undefined, hayRoadmap: boolean): string {
  const para = t?.tipo === 'proyecto_nivel' ? (t.nivel != null ? `detallar el nivel ${t.nivel}` : 'detallar el nivel') : hayRoadmap ? 'rehacer el roadmap' : 'preparar el roadmap'
  const delante = t?.cola?.por_delante ?? 0
  const donde = delante > 0 ? `${delante === 1 ? 'hay 1 trabajo' : `hay ${delante} trabajos`} por delante` : 'es el siguiente'
  const mientras = hayRoadmap ? ' Mientras, puedes seguir usando el proyecto: marcar pasos, el diario y el asesor.' : ''
  return `En cola para ${para}: ${donde}.${mientras}`
}
