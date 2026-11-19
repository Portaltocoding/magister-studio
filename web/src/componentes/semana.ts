// «Esta semana» en Hoy: las horas y sesiones de lunes a domingo de todos tus planes, igual que «Lo que toca», que
// también los junta. Puro, con pruebas en web/pruebas/semana.test.ts.

interface SesionSemana {
  horas: number
  estado: string
}
interface VistaSemanas {
  semanas: { dias: { fecha: string; sesiones: SesionSemana[] }[] }[]
}

export interface Semana {
  hechas: number
  total: number
  sesiones: number
  hechasN: number
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// El lunes y el domingo de la semana de `hoy` (AAAA-MM-DD).
export function limitesSemana(hoy: string): [string, string] {
  const [a, m, d] = hoy.split('-').map(Number)
  const dia = new Date(a, m - 1, d, 12)
  const desdeLunes = (dia.getDay() + 6) % 7
  return [iso(new Date(a, m - 1, d - desdeLunes, 12)), iso(new Date(a, m - 1, d - desdeLunes + 6, 12))]
}

export function semanaDeTodos(vistas: VistaSemanas[], hoy: string): Semana {
  const [lunes, domingo] = limitesSemana(hoy)
  const ses = vistas.flatMap((v) => v.semanas.flatMap((s) => s.dias.filter((d) => d.fecha >= lunes && d.fecha <= domingo).flatMap((d) => d.sesiones)))
  const hechas = ses.filter((x) => x.estado === 'hecha')
  return {
    total: ses.reduce((a, x) => a + x.horas, 0),
    hechas: hechas.reduce((a, x) => a + x.horas, 0),
    sesiones: ses.length,
    hechasN: hechas.length,
  }
}
