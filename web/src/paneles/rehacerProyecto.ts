// Rehacer el roadmap de un proyecto sin perder lo hecho: qué se le cuenta antes (para confirmarlo) y después.
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

// Lo que pasó al rehacer, en una frase (null si este roadmap no viene de rehacer otro).
export function resumenRehecho(conservados: number | undefined, yaNoEstan: HechoQueYaNoEsta[]): string | null {
  if (conservados == null && yaNoEstan.length === 0) return null
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
