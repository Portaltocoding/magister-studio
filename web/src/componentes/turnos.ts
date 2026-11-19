// Reglas puras del hilo del chat: qué flujo manda, qué queda si el envío falla, cuándo recargar una conversación
// y cuánto cabe en un mensaje. Sin React, para poder probarlas con el corredor de Node.

// El mismo límite que pone el servidor al mensaje (MensajeEntrada.contenido en api/esquemas.py).
export const LIMITE_MENSAJE = 20_000

// Python cuenta caracteres y JavaScript unidades UTF-16 (un emoji vale 2): se cuentan como el servidor.
export const largoMensaje = (texto: string) => (texto.length <= LIMITE_MENSAJE ? texto.length : Array.from(texto).length)

export const demasiadoLargo = (texto: string) => largoMensaje(texto.trim()) > LIMITE_MENSAJE

// Cada flujo recibe un turno. Al cambiar de conversación se suelta el vigente: sigue llegando (el servidor lo termina y lo
// guarda entero), pero sus eventos ya no tocan el hilo que estás viendo ni «Parar» lo corta.
export function crearTurnos() {
  let actual = 0
  return {
    nuevo: () => ++actual,
    vigente: (turno: number) => turno === actual,
    soltar: () => {
      actual++
    },
  }
}

// El envío falló antes de empezar: se quita la burbuja vacía del tutor y se pone el error. Tu mensaje se queda.
export function trasFalloAlEnviar<B>(previas: B[], error: B): B[] {
  return [...previas.slice(0, -1), error]
}

// Sin conexión el mensaje no ha salido: se quitan tu burbuja (si la había) y la del tutor, y queda solo el aviso. El texto
// vuelve a la caja; si se quedara también en el hilo, al reenviarlo saldría dos veces.
export function trasFalloSinConexion<B>(previas: B[], error: B, conPropia: boolean): B[] {
  return [...previas.slice(0, conPropia ? -2 : -1), error]
}

// La conversación que se acaba de crear aquí no se recarga desde la API (borraría la respuesta que llega). En cuanto abres
// otra, deja de serlo: si no, al volver a ella no se recargaría y verías los mensajes de la otra.
export function recienCreadaTras(recienCreada: number | null, conversacionId: number | null): number | null {
  return recienCreada !== null && recienCreada !== conversacionId ? null : recienCreada
}
