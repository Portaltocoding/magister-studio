import { usarAdjuntos } from './componentes/usarAdjuntos.ts'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  crearConversacion,
  decidir,
  enviar,
  lanzarResearch,
  listarMensajes,
  propuestaPendiente,
  verPlan,
  type Propuesta,
} from './api.ts'
import Cuestionario from './componentes/Cuestionario.tsx'
import BarraCuota from './componentes/BarraCuota.tsx'
import { irARuta } from './componentes/Vacio.tsx'
import { mensajePlan, PREGUNTAS_PLAN } from './componentes/cuestionarios.ts'
import Hilo from './componentes/Hilo.tsx'
import { aBurbuja, usarConversacion } from './componentes/usarConversacion.ts'
import Mascota from './Mascota.tsx'
import PropuestaPlan from './PropuestaPlan.tsx'
import { SelectorModo } from './componentes/Modos.tsx'

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
  const [aviso, setAviso] = useState<string | null>(null)
  const [aMano, setAMano] = useState(false)
  const buscarAlGuardar = useRef(false)
  const alGuardado = useCallback(async (planId: number, temaId: number) => {
    if (!buscarAlGuardar.current) return
    buscarAlGuardar.current = false
    const vista = await verPlan(temaId)
    const claves = vista.lecciones.filter((l) => l.sin_material).map((l) => l.clave)
    if (!claves.length) return setAviso('Todas las lecciones tienen ya material en tus fuentes.')
    await lanzarResearch(planId, claves)
    setAviso(`Buscando fuentes para ${claves.length} lecciones. Las propuestas te llegarán a «Temas y fuentes» para que las apruebes.`)
  }, [])

  const abrir = useCallback(
    (texto: string, signal: AbortSignal) => {
      if (conversacionId == null) throw new Error('sin conversación')
      return enviar(conversacionId, texto, signal, !noCuenta)
    },
    [conversacionId, noCuenta],
  )
  const { burbujas, setBurbujas, escribiendo, fase, opciones, enviar: mandar, correr, parar } = usarConversacion(
    abrir,
    setPropuesta,
    alGuardado,
  )
  const [pendiente, setPendiente] = useState<string | null>(null)
  const { adjuntos, subir, quitar } = usarAdjuntos()
  const conAdjuntos = { alAdjuntar: subir, adjuntos, alQuitarAdjunto: quitar }
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
    // Otra pantalla la acaba de crear con su primer mensaje («Me he atascado» de Proyectos): se envía al abrirla.
    try {
      const guardado = JSON.parse(sessionStorage.getItem('magister-enviar-al-abrir') ?? 'null') as { cid: number; texto: string } | null
      if (guardado?.cid === conversacionId) {
        sessionStorage.removeItem('magister-enviar-al-abrir')
        recienCreada.current = conversacionId
        setBurbujas([])
        setPendiente(guardado.texto)
        return
      }
    } catch {
      /* sin almacenamiento */
    }
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
      {opciones.length > 0 && !escribiendo && !propuesta && (
        <div className="respuestas-rapidas" aria-label="Respuestas rápidas">
          {opciones.map((o) => (
            <button key={o.valor} className="opcion opcion-chip" onClick={() => alEnviar(o.valor)}>
              {o.etiqueta}
            </button>
          ))}
        </div>
      )}

      {propuesta && (
        <PropuestaPlan
          propuesta={propuesta}
          ocupado={escribiendo}
          alAceptar={(buscar) => {
            buscarAlGuardar.current = buscar
            resolver('aceptar')
          }}
          alCambiar={(t) => resolver('cambiar', t)}
        />
      )}
      {aviso && (
        <p className="nota" role="status">
          {aviso}
        </p>
      )}
      {tipo === 'libre' && (
        <div className="pie-chat">
          <SelectorModo />
          <label className="interruptor" title="Para explorar o equivocarte a propósito sin falsear tu perfil">
            <input type="checkbox" checked={noCuenta} onChange={(e) => setNoCuenta(e.target.checked)} /> Esto no
            cuenta para el tutor
          </label>
        </div>
      )}
    </>
  )

  if (conversacionId == null && !pendiente && tipo === 'plan' && !aMano) {
    return (
      <div className="libre">
        <Mascota lugar="libre" />
        {error && <p role="alert">{error}</p>}
        <Cuestionario
          titulo="Nuevo plan"
          preguntas={PREGUNTAS_PLAN}
          boton="Prepárame el plan"
          alTerminar={(r) => alEnviar(mensajePlan(r))}
          alSaltar={() => setAMano(true)}
        />
        <BarraCuota accion={{ accion: 'plan' }} />
      </div>
    )
  }

  if (conversacionId == null && !pendiente) {
    return (
      <div className="libre">
        <Mascota lugar="libre" />
        <h1>{tipo === 'plan' ? '¿Qué quieres aprender, para qué y con cuánto tiempo?' : '¿Qué tema tratamos hoy?'}</h1>
        {tipo === 'plan' && (
          <p className="nota">
            Cuéntamelo con tus palabras: el tema, para qué lo quieres, lo que ya sabes, cuántas horas tienes y hasta
            cuándo. Si falta algo, te lo pregunto.
          </p>
        )}
        {tipo === 'libre' && (
          <button type="button" className="libre-a-plan" onClick={() => irARuta('#/nuevo-plan')}>
            ¿Quieres estudiarlo con un plan, con lecciones y calendario? Crear un plan →
          </button>
        )}
        {error && <p role="alert">{error}</p>}
        <Hilo
          burbujas={[]}
          escribiendo={false}
          alEnviar={alEnviar}
          alParar={parar}
          placeholder={tipo === 'plan' ? 'Quiero preparar...' : 'Escribe un tema o una pregunta'}
          pie={pie}
          {...conAdjuntos}
        />
      </div>
    )
  }

  return (
    <div className="vista-hilo">
      {error && <p role="alert">{error}</p>}
      <Hilo burbujas={burbujas} escribiendo={escribiendo} alEnviar={alEnviar} alParar={parar} pie={pie} fase={fase} guardable={tipo === 'libre'} {...conAdjuntos} />
    </div>
  )
}
