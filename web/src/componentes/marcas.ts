// Las marcas [123] del tutor pasan a enlaces internos que el hilo pinta como botones.
// Se recomponen aunque lleguen partidas entre dos deltas, porque se aplican al texto entero.
// Dentro del código (```…``` o `…`) no se tocan: ahí el Markdown no se interpreta y `arr[0]` saldría roto.
// El `$` cubre el bloque que aún no se ha cerrado mientras llega el texto.
const CODIGO = /(```[\s\S]*?(?:```|$)|`[^`\n]*`)/

export const conMarcas = (texto: string) =>
  texto
    .split(CODIGO)
    .map((tramo, i) => (i % 2 === 1 ? tramo : tramo.replace(/\[(\d{1,9})\]/g, '[\\[$1\\]](#cita-$1)')))
    .join('')
