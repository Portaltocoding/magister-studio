import { usarAdjuntos } from './componentes/usarAdjuntos.ts'
import { t } from './i18n/i18n.ts'
import { usarIdioma } from './i18n/usarIdioma.ts'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  crearConversacion,
  decidir,
  enviar,
  ErrorApi,
  lanzarResearch,
  listarMensajes,
  listarPlanes,
  propuestaPendiente,
  verPlan,
  type Propuesta,
} from './api.ts'
import Cuestionario, { borrarCuestionario } from './componentes/Cuestionario.tsx'
import BarraCuota from './componentes/BarraCuota.tsx'
import { avisoAlAceptar, clavesParaBuscar } from './componentes/bibliotecaLeccion.ts'
import Vacio, { irARuta } from './componentes/Vacio.tsx'
import { TextoError } from './componentes/Cargando.tsx'
import { cortarTitulo } from './componentes/formato.ts'
import { recordarPlan } from './componentes/planActivo.ts'
import { mensajeSinConexion } from './componentes/errores.ts'
import { mensajePlan, preguntasPlan } from './componentes/cuestionarios.ts'
import Hilo from './componentes/Hilo.tsx'
import { usarConversacion } from './componentes/usarConversacion.ts'
import { escribirEnChat } from './componentes/preferencias.ts'
import { recienCreadaTras } from './componentes/turnos.ts'
import Mascota from './Mascota.tsx'
import PropuestaPlan from './PropuestaPlan.tsx'
import { SelectorModo } from './componentes/Modos.tsx'

interface Props {
  conversacionId: number | null
  tipo: 'libre' | 'plan'
  alCrear: (id: number) => void
  alCambiar: () => void
}

// Las respuestas del cuestionario del plan, mientras lo rellenas (recargar no las pierde).
const CLAVE_CUESTIONARIO = 'magister-cuestionario-plan'

// Estudio libre (preguntas lo que quieres) y la conversación de diagnóstico que acaba en un plan.
export default function EstudioLibre({ conversacionId, tipo, alCrear, alCambiar }: Props) {
  usarIdioma() // los textos siguen al idioma
  const [noCuenta, setNoCuenta] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [noExiste, setNoExiste] = useState(false)
  const [propuesta, setPropuesta] = useState<Propuesta | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [aMano, setAMano] = useState(false)
  const buscarAlGuardar = useRef(false)
  const alGuardado = useCallback(async (planId: number, temaId: number) => {
    if (!buscarAlGuardar.current) return
    buscarAlGuardar.current = false
    const vista = await verPlan(temaId)
    if (!vista.lecciones.some((l) => l.sin_material)) return setAviso(t('libre.sinMaterial'))
    const claves = clavesParaBuscar(vista.lecciones)
    if (!claves.length) return setAviso(avisoAlAceptar(0))
    const r = await lanzarResearch(planId, claves)
    setAviso(avisoAlAceptar(r.tareas.length, r.aviso))
  }, [])

  const abrir = useCallback(
    (texto: string, signal: AbortSignal) => {
      if (conversacionId == null) throw new Error('sin conversación')
      return enviar(conversacionId, texto, signal, !noCuenta)
    },
    [conversacionId, noCuenta],
  )
  // Aceptaste un plan que ya estaba aceptado (dos clics, otra pestaña): no es un fallo, te lleva a ese plan en Roadmap.
  const alYaDecidido = useCallback((planId: number | null) => {
    setPropuesta(null)
    listarPlanes()
      .then((ps) => {
        const p = ps.find((x) => x.plan_id === planId)
        if (p) recordarPlan(p.tema_id)
      })
      .catch(() => undefined)
      .finally(() => window.setTimeout(() => irARuta('#/roadmap'), 1200))
  }, [])
  const { burbujas, setBurbujas, cargar, escribiendo, fase, espera, opciones, enviar: mandar, correr, parar, soltar } = usarConversacion(
    abrir,
    setPropuesta,
    alGuardado,
    alYaDecidido,
  )
  const [pendiente, setPendiente] = useState<string | null>(null)
  const { adjuntos, subir, quitar } = usarAdjuntos()
  const conAdjuntos = { alAdjuntar: subir, adjuntos, alQuitarAdjunto: quitar }
  // La que acabamos de crear aquí: no se recarga desde la API, o borraría la respuesta que está llegando.
  const recienCreada = useRef<number | null>(null)

  useEffect(() => {
    let vigente = true
    setError(null)
    setNoExiste(false)
    setPropuesta(null)
    recienCreada.current = recienCreadaTras(recienCreada.current, conversacionId)
    if (conversacionId == null) {
      soltar()
      setBurbujas([])
      return
    }
    // La recién creada: su primera respuesta acaba de empezar y no se suelta.
    if (recienCreada.current === conversacionId) return
    // Si la anterior seguía respondiendo, termina en segundo plano (se guarda entera) y no se mezcla con esta.
    soltar()
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
      .then((ms) => vigente && cargar(ms))
      .catch((e) => {
        if (!vigente) return
        // Un enlace a una conversación borrada o que nunca existió: pantalla vacía, no el error del servidor.
        if (e instanceof ErrorApi && e.codigo === 404) setNoExiste(true)
        else setError(String(e.message ?? e))
      })
    propuestaPendiente(conversacionId)
      .then((p) => vigente && setPropuesta(p))
      .catch(() => undefined)
    return () => {
      vigente = false
    }
  }, [conversacionId, setBurbujas, soltar])

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
        // El título, cortado por palabra (no a media palabra) y con «…» si no cabe entero.
        const titulo = tipo === 'plan' ? t('libre.tituloPlan', { texto: cortarTitulo(texto, 50) }) : cortarTitulo(texto, 60)
        const c = await crearConversacion(titulo, null, tipo)
        if (tipo === 'plan') borrarCuestionario(CLAVE_CUESTIONARIO)
        recienCreada.current = c.id
        setPendiente(texto)
        alCrear(c.id)
      } catch (e) {
        setError(e instanceof ErrorApi && e.codigo === 0 ? mensajeSinConexion() : String((e as Error).message))
        escribirEnChat(texto) // lo que escribiste vuelve a la caja
      }
      return
    }
    mandar(texto, alCambiar)
  }

  const resolver = (accion: 'aceptar' | 'cambiar' | 'descartar', texto: string | null = null) => {
    if (conversacionId == null) return
    setPropuesta(null)
    correr(accion === 'cambiar' ? texto : null, (signal) => decidir(conversacionId, accion, texto, signal), alCambiar)
  }

  const pie = (
    <>
      {opciones.length > 0 && !escribiendo && !propuesta && (
        <div className="respuestas-rapidas" aria-label={t('libre.rapidas')}>
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
          alDescartar={() => resolver('descartar')}
        />
      )}
      {aviso && (
        <p className="nota" role="status">
          {aviso}
        </p>
      )}
    </>
  )
  // Debajo de la caja, discretas: el modo y «esto no cuenta». El idioma ya no va aquí: es el de toda la app (Ajustes).
  const opcionesChat =
    tipo === 'libre' ? (
      <div className="pie-chat">
        <SelectorModo />
        <label className="interruptor" title={t('libre.noCuentaTitulo')}>
          <input type="checkbox" checked={noCuenta} onChange={(e) => setNoCuenta(e.target.checked)} /> {t('libre.noCuenta')}
        </label>
      </div>
    ) : undefined

  if (conversacionId == null && !pendiente && tipo === 'plan' && !aMano) {
    return (
      <div className="libre">
        <Mascota lugar="libre" />
        {error && <p role="alert">{error}</p>}
        <Cuestionario
          titulo={t('libre.nuevoPlan')}
          preguntas={preguntasPlan()}
          boton={t('libre.preparaPlan')}
          alTerminar={(r) => alEnviar(mensajePlan(r))}
          alSaltar={() => setAMano(true)}
          guardarComo={CLAVE_CUESTIONARIO}
        />
        <BarraCuota accion={{ accion: 'plan' }} />
      </div>
    )
  }

  if (conversacionId == null && !pendiente) {
    return (
      <div className="libre">
        <Mascota lugar="libre" />
        <h1>{tipo === 'plan' ? t('libre.hPlan') : t('libre.hTema')}</h1>
        {tipo === 'plan' && (
          <p className="nota">
            {t('libre.notaPlan')}
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        <Hilo
          burbujas={[]}
          escribiendo={false}
          alEnviar={alEnviar}
          alParar={parar}
          placeholder={tipo === 'plan' ? t('libre.phPlan') : t('libre.phLibre')}
          pie={pie}
          bajoCaja={opcionesChat}
          {...conAdjuntos}
        />
        {tipo === 'libre' && (
          <button type="button" className="libre-a-plan" onClick={() => irARuta('#/nuevo-plan')}>
            {t('libre.aPlan')}
          </button>
        )}
      </div>
    )
  }

  if (noExiste)
    return (
      <div className="libre">
        <Vacio
          etiqueta={t('vacio.libre.etq')}
          titulo={t('vacio.libre.titulo')}
          texto={t('vacio.libre.texto')}
          acciones={[{ texto: t('vacio.libre.nueva'), principal: true, alPulsar: () => irARuta('#/libre') }]}
        />
        <Hilo burbujas={[]} escribiendo={false} alEnviar={() => undefined} alParar={parar} placeholder={t('libre.noExiste')} deshabilitado />
      </div>
    )

  return (
    <div className="vista-hilo">
      {error && <TextoError texto={error} />}
      <Hilo burbujas={burbujas} escribiendo={escribiendo} alEnviar={alEnviar} alParar={parar} pie={pie} bajoCaja={opcionesChat} fase={fase} espera={espera} guardable={tipo === 'libre'} {...conAdjuntos} />
    </div>
  )
}
