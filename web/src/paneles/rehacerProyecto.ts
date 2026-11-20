// Rehacer el roadmap de un proyecto sin perder lo hecho: qué se le cuenta antes (para confirmarlo) y después. Y qué
// dice la pantalla mientras su trabajo espera en la cola o corre.
// Lógica pura, con test en pruebas/rehacerProyecto.test.ts.
import { t as tr } from '../i18n/i18n.ts'

export interface HechoQueYaNoEsta {
  id: string
  titulo: string
  hecho_en: string | null
}

const pasosHechos = (n: number) => (n === 1 ? tr('proyectos.rehacer.pasoHecho') : tr('proyectos.rehacer.pasosHechos', { n }))

// Lo que pasa al rehacer, antes de confirmarlo. `hechos`: los pasos hechos que hay ahora en el roadmap.
export function avisoRehacer(hechos: number): string {
  const conservar =
    hechos > 0
      ? tr('proyectos.rehacer.avisoConserva', { pasos: pasosHechos(hechos) })
      : tr('proyectos.rehacer.avisoSin')
  return `${conservar} ${tr('proyectos.rehacer.avisoGuarda')}`
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
    if (total === 0) return tr('proyectos.rehacer.ninguno')
    const lista = perdidos.map((x) => `«${x.titulo}»`).join(', ')
    if (!perdidos.length) return total === 1 ? tr('proyectos.rehacer.unoConservado') : tr('proyectos.rehacer.todosConservados', { n: total })
    const cuantos =
      conservados === 0
        ? total === 1
          ? tr('proyectos.rehacer.noTuPaso')
          : tr('proyectos.rehacer.noNinguno', { pasos: pasosHechos(total) })
        : tr(conservados === 1 ? 'proyectos.rehacer.cuantosUno' : 'proyectos.rehacer.cuantosVarios', { n: conservados, pasos: pasosHechos(total) })
    return tr(perdidos.length === 1 ? 'proyectos.rehacer.noSigue' : 'proyectos.rehacer.noSiguen', { cuantos, lista })
  }
  const partes: string[] = []
  if (conservados != null) partes.push(conservados > 0 ? tr('proyectos.rehacer.conservadosN', { pasos: pasosHechos(conservados) }) : tr('proyectos.rehacer.ningunPaso'))
  if (yaNoEstan.length > 0)
    partes.push(
      yaNoEstan.length === 1
        ? tr('proyectos.rehacer.unoYaNoEsta')
        : tr('proyectos.rehacer.variosYaNoEstan', { n: yaNoEstan.length }),
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

const FASES = ['referencias', 'roadmap', 'arquitectura']

// Qué está haciendo, en palabras: rehacer no es «detallar el nivel».
export function queHace(t: TrabajoProyecto | null | undefined, hayRoadmap: boolean): string {
  if (t?.tipo === 'proyecto_nivel') return t.nivel != null ? tr('proyectos.fase.detallandoN', { n: t.nivel }) : tr('proyectos.fase.detallando')
  const nodo = t?.nodo ?? ''
  if (FASES.includes(nodo)) return hayRoadmap && nodo === 'roadmap' ? tr('proyectos.fase.rehaciendoRoadmap') : tr(`proyectos.fase.${nodo}` as 'proyectos.fase.roadmap')
  return hayRoadmap ? tr('proyectos.fase.rehaciendo') : tr('proyectos.fase.preparando')
}

// Lo que dice mientras espera en la cola: para qué, cuántos tiene delante y que el proyecto se sigue usando.
export function textoEnCola(t: TrabajoProyecto | null | undefined, hayRoadmap: boolean): string {
  const para =
    t?.tipo === 'proyecto_nivel'
      ? t.nivel != null
        ? tr('proyectos.cola.detallarN', { n: t.nivel })
        : tr('proyectos.cola.detallar')
      : hayRoadmap
        ? tr('proyectos.cola.rehacer')
        : tr('proyectos.cola.preparar')
  const delante = t?.cola?.por_delante ?? 0
  const donde = delante > 0 ? (delante === 1 ? tr('proyectos.cola.delante1') : tr('proyectos.cola.delanteN', { n: delante })) : tr('proyectos.cola.siguiente')
  const mientras = hayRoadmap ? tr('proyectos.cola.mientras') : ''
  return tr('proyectos.cola.texto', { para, donde, mientras })
}
