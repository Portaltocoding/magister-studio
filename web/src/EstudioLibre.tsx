import { useCallback, useEffect, useRef, useState } from 'react'
import { crearConversacion, decidir, enviar, listarMensajes, propuestaPendiente, type Propuesta } from './api.ts'
import Hilo from './componentes/Hilo.tsx'
import { aBurbuja, usarConversacion } from './componentes/usarConversacion.ts'
import Mascota from './Mascota.tsx'
import PropuestaPlan from './PropuestaPlan.tsx'

interface Props {
  conversacionId: number | null
  tipo: 'libre' | 'plan'
  alCrear: (id: number) => void
  alCambiar: () => void
}

// Estudio libre (preguntas lo que quieres) y la conversación de diagnóstico que acaba en un plan.
export default function EstudioLibre({ conversacionId, tipo, alCrear, alCambiar }: Props) {
  const [noCuenta, setNoCuenta] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [propuesta, setPropuesta] = useState<Propuesta | null>(null)

  const abrir = useCallback(
    (texto: string, signal: AbortSignal) => {
      if (conversacionId == null) throw new Error('sin conversación')
      return enviar(conversacionId, texto, signal, !noCuenta)
    },
    [conversacionId, noCuenta],
  )
  const { burbujas, setBurbujas, escribiendo, fase, enviar: mandar, correr, parar } = usarConversacion(
    abrir,
    setPropuesta,
  )
  const [pendiente, setPendiente] = useState<string | null>(null)
  // La que acabamos de crear aquí: no se recarga desde la API, o borraría la respuesta que está llegando.
  const recienCreada = useRef<number | null>(null)

  useEffect(() => {
    let vigente = true
    setError(null)
    setPropuesta(null)
    if (conversacionId == null) {
      setBurbujas([])
      return
    }
    if (recienCreada.current === conversacionId) return
    listarMensajes(conversacionId)
      .then((ms) => vigente && setBurbujas(ms.map(aBurbuja)))
      .catch((e) => vigente && setError(String(e.message ?? e)))
    propuestaPendiente(conversacionId)
      .then((p) => vigente && setPropuesta(p))
      .catch(() => undefined)
    return () => {
      vigente = false
    }
  }, [conversacionId, setBurbujas])

  // La primera pregunta crea la conversación y se envía cuando ya existe.
  useEffect(() => {
    if (pendiente && conversacionId != null && !escribiendo) {
      const texto = pendiente
      setPendiente(null)
      mandar(texto, alCambiar)
    }
  }, [pendiente, conversacionId, escribiendo, mandar, alCambiar])

  const alEnviar = async (texto: string) => {
    setPropuesta(null)
    if (conversacionId == null) {
      try {
        const titulo = tipo === 'plan' ? `Plan: ${texto.slice(0, 50)}` : texto.slice(0, 60)
        const c = await crearConversacion(titulo, null, tipo)
        recienCreada.current = c.id
        setPendiente(texto)
        alCrear(c.id)
      } catch (e) {
        setError(String((e as Error).message))
      }
      return
    }
    mandar(texto, alCambiar)
  }

  const resolver = (accion: 'aceptar' | 'cambiar', texto: string | null = null) => {
    if (conversacionId == null) return
    setPropuesta(null)
    correr(accion === 'cambiar' ? texto : null, (signal) => decidir(conversacionId, accion, texto, signal), alCambiar)
  }

  const pie = (
    <>
      {fase && (
        <p className="fase" role="status">
          {fase}…
        </p>
      )}
      {propuesta && (
        <PropuestaPlan
          propuesta={propuesta}
          ocupado={escribiendo}
          alAceptar={() => resolver('aceptar')}
          alCambiar={(t) => resolver('cambiar', t)}
        />
      )}
      {tipo === 'libre' && (
        <label className="interruptor" title="Para explorar o equivocarte a propósito sin falsear tu perfil">
          <input type="checkbox" checked={noCuenta} onChange={(e) => setNoCuenta(e.target.checked)} /> Esto no
          cuenta para el tutor
        </label>
      )}
    </>
  )

  if (conversacionId == null && !pendiente) {
    return (
      <div className="libre">
        <Mascota />
        <h1>{tipo === 'plan' ? '¿Qué quieres aprender, para qué y con cuánto tiempo?' : '¿Qué tema tratamos hoy?'}</h1>
        {tipo === 'plan' && (
          <p className="nota">
            Cuéntamelo con tus palabras: el tema, para qué lo quieres, lo que ya sabes, cuántas horas tienes y hasta
            cuándo. Si falta algo, te lo pregunto.
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        <Hilo
          burbujas={[]}
          escribiendo={false}
          alEnviar={alEnviar}
          alParar={parar}
          placeholder={tipo === 'plan' ? 'Quiero preparar...' : 'Escribe un tema o una pregunta'}
          pie={pie}
        />
      </div>
    )
  }

  return (
    <div className="vista-hilo">
      {error && <p role="alert">{error}</p>}
      <Hilo burbujas={burbujas} escribiendo={escribiendo} alEnviar={alEnviar} alParar={parar} pie={pie} />
    </div>
  )
}
