import { useCallback, useEffect, useState } from 'react'
import { crearConversacion, enviar, listarMensajes } from './api.ts'
import Hilo from './componentes/Hilo.tsx'
import { aBurbuja, usarConversacion } from './componentes/usarConversacion.ts'
import Mascota from './Mascota.tsx'

interface Props {
  conversacionId: number | null
  alCrear: (id: number) => void
  alCambiar: () => void
}

// Modo Estudio libre: preguntas lo que quieres y decides tú.
export default function EstudioLibre({ conversacionId, alCrear, alCambiar }: Props) {
  const [noCuenta, setNoCuenta] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const abrir = useCallback(
    (texto: string, signal: AbortSignal) => {
      if (conversacionId == null) throw new Error('sin conversación')
      return enviar(conversacionId, texto, signal, !noCuenta)
    },
    [conversacionId, noCuenta],
  )
  const { burbujas, setBurbujas, escribiendo, enviar: mandar, parar } = usarConversacion(abrir)
  const [pendiente, setPendiente] = useState<string | null>(null)

  useEffect(() => {
    let vigente = true
    setError(null)
    if (conversacionId == null) {
      setBurbujas([])
      return
    }
    listarMensajes(conversacionId)
      .then((ms) => {
        if (!vigente) return
        setBurbujas(ms.map(aBurbuja))
      })
      .catch((e) => vigente && setError(String(e.message ?? e)))
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
    if (conversacionId == null) {
      try {
        const c = await crearConversacion(texto.slice(0, 60))
        setPendiente(texto)
        alCrear(c.id)
      } catch (e) {
        setError(String((e as Error).message))
      }
      return
    }
    mandar(texto, alCambiar)
  }

  const interruptor = (
    <label className="interruptor" title="Para explorar o equivocarte a propósito sin falsear tu perfil">
      <input type="checkbox" checked={noCuenta} onChange={(e) => setNoCuenta(e.target.checked)} /> Esto no cuenta
      para el tutor
    </label>
  )

  if (conversacionId == null && !pendiente) {
    return (
      <div className="libre">
        <Mascota />
        <h1>¿Qué tema tratamos hoy?</h1>
        {error && <p role="alert">{error}</p>}
        <Hilo
          burbujas={[]}
          escribiendo={false}
          alEnviar={alEnviar}
          alParar={parar}
          placeholder="Escribe un tema o una pregunta"
          pie={interruptor}
        />
      </div>
    )
  }

  return (
    <div className="vista-hilo">
      {error && <p role="alert">{error}</p>}
      <Hilo burbujas={burbujas} escribiendo={escribiendo} alEnviar={alEnviar} alParar={parar} pie={interruptor} />
    </div>
  )
}
