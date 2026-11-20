import { t } from '../i18n/i18n.ts'
// Lógica pura de la pantalla Lecciones (PanelMaterial): la ruta, el estado de cada lección en la lista, la barra de
// progreso de un trabajo y su sitio en la cola. Sin React, para probarla con el corredor de Node.

export type Pestana = 'apuntes' | 'fichas' | 'diapositivas' | 'guion'
export const PESTANAS: Pestana[] = ['apuntes', 'fichas', 'diapositivas', 'guion']

// La ruta de una lección: #/fichas/<tema>/<lección>/<pestaña> (o #/video/…). Al recargar te deja donde estabas.
export interface RutaLeccion {
  modo: string
  tema: number | null
  clave: string | null
  pestana: Pestana | null
}

export function leerRutaLeccion(hash: string): RutaLeccion {
  const [modo = '', tema, clave, pestana] = hash.replace(/^#\/?/, '').split('/')
  const n = Number(tema)
  return {
    modo,
    tema: tema && Number.isInteger(n) && n > 0 ? n : null,
    clave: clave ? decodeURIComponent(clave) : null,
    pestana: PESTANAS.includes(pestana as Pestana) ? (pestana as Pestana) : null,
  }
}

export function rutaLeccion(modo: 'fichas' | 'video', tema: number, clave: string | null, pestana: Pestana): string {
  return clave ? `#/${modo}/${tema}/${encodeURIComponent(clave)}/${pestana}` : `#/${modo}/${tema}`
}

// Lo que dice la lista de cada lección. «En cola» no es «Generando», y unas diapositivas que se hacen sobre unos
// apuntes listos no los esconden: la lección sigue lista, con lo que se está haciendo al lado.
export interface EstadoLeccion {
  tipos: Record<string, string>
  fichas: number
  en_marcha: boolean
  apuntes_listos?: boolean
  trabajo?: { id: number; estado: 'pendiente' | 'en_curso'; tipos: string[] } | null
}

const EXTRAS: Record<string, 'material.est.diapositivas' | 'material.est.guion'> = { diapositivas: 'material.est.diapositivas', guion: 'material.est.guion' }

export function estadoLeccion(e: EstadoLeccion | undefined): { clase: string; texto: string } {
  if (!e) return { clase: 'sin', texto: t('material.est.sin') }
  const trab = e.trabajo ?? (e.en_marcha ? { id: 0, estado: 'en_curso' as const, tipos: ['apuntes'] } : null)
  const base =
    e.tipos.apuntes === 'listo'
      ? { clase: 'listo', texto: t('material.est.listo', { n: e.fichas }) }
      : e.tipos.apuntes === 'revisar'
        ? { clase: 'revisar', texto: t('material.est.revisar', { n: e.fichas }) }
        : e.tipos.apuntes === 'bloqueado'
          ? { clase: 'revisar', texto: t('material.est.bloqueado') }
          : null
  if (trab) {
    const soloExtras = trab.tipos.length > 0 && trab.tipos.every((x) => x in EXTRAS)
    if (soloExtras && base) {
      const que = trab.tipos.map((x) => t(EXTRAS[x])).join(t('material.est.y'))
      return { clase: base.clase, texto: `${base.texto} · ${trab.estado === 'pendiente' ? t('material.est.enCola', { que }) : t('material.est.haciendo', { que })}` }
    }
    return trab.estado === 'pendiente' ? { clase: 'cola', texto: t('material.est.cola') } : { clase: 'marcha', texto: t('material.est.generando') }
  }
  return base ?? { clase: 'sin', texto: t('material.est.sin') }
}

// La barra de un trabajo de material, de 0 a 100, por fases: el trabajo pasa por varias y cada una trae su propio
// «paso de total» (preparar la lección es 1 de 1). Contarlas por separado hacía saltar la barra de 5 % a 100 % y
// volver a 25 %. Aquí cada fase ocupa su tramo; quien pinta guarda además el máximo, para que nunca retroceda.
const TRAMOS: Record<string, [number, number]> = {
  pendiente: [0, 2],
  en_curso: [2, 4],
  entrada: [4, 8],
  contrato: [8, 14],
  comprobar: [12, 14],
  escribir: [14, 78],
  lint: [14, 78],
  juez: [14, 78],
  refinar: [14, 78],
  aceptar: [14, 78],
  montar: [78, 82],
  completitud: [82, 86],
  ampliar: [86, 89],
  preguntas: [89, 93],
  pintar: [93, 97],
  diapositivas: [10, 95],
  guion: [10, 95],
}

export function porcentaje(nodo: string | null, paso: number, total: number): number {
  const [desde, hasta] = TRAMOS[nodo ?? ''] ?? [2, 4]
  if (total <= 1) return desde
  const dentro = Math.min(1, Math.max(0, paso / total))
  return Math.round(desde + (hasta - desde) * dentro)
}

// Dónde está un trabajo que espera (campo `cola` de /api/trabajos/{id}).
export interface Cola {
  por_delante: number
  en_marcha: number
  a_la_vez: number
  reintento_desde?: string | null
}

export function textoCola(c: Cola | null | undefined): string {
  if (!c) return t('material.est.cola')
  if (c.reintento_desde) return t('material.cola.reintento')
  if (c.por_delante > 0) return t('material.cola.delante', { n: c.por_delante })
  if (c.en_marcha >= c.a_la_vez) return t('material.cola.espera')
  return t('material.cola.enseguida')
}
