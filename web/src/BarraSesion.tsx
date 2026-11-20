import { useEffect, useRef, useState } from 'react'
import { EVENTO_SIN_RESPUESTA, pedir } from './api.ts'
import Afinar from './componentes/Afinar.tsx'
import Tomate from './componentes/Tomate.tsx'
import { EVENTO_CONECTADO } from './componentes/Cargando.tsx'
import { usarIdioma } from './i18n/usarIdioma.ts'

type Estado = 'comprobando' | 'conectado' | 'sin conexión'

interface Alerta {
  id: number
  nombre: string
  detalle: string
  runbook: string
}

export default function BarraSesion({ alMenu }: { alMenu?: () => void }) {
  const { t } = usarIdioma()
  const [estado, setEstado] = useState<Estado>('comprobando')
  const [alertas, setAlertas] = useState<Alerta[]>([])
  // La alerta que no se pudo marcar como resuelta: el botón lo dice en vez de no hacer nada.
  const [sinResolver, setSinResolver] = useState<number | null>(null)
  const [verAvisos, setVerAvisos] = useState(false)
  const cajaAvisos = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!verAvisos) return
    const fuera = (e: MouseEvent) => cajaAvisos.current && !cajaAvisos.current.contains(e.target as Node) && setVerAvisos(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setVerAvisos(false)
    document.addEventListener('mousedown', fuera)
    window.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', fuera)
      window.removeEventListener('keydown', esc)
    }
  }, [verAvisos])
  const resolver = (id: number) => {
    setSinResolver(null)
    pedir(`/api/alertas/${id}/resolver`, { method: 'POST' })
      .then(() => setAlertas((as) => as.filter((x) => x.id !== id)))
      .catch(() => setSinResolver(id))
  }

  useEffect(() => {
    let vigente = true
    let antes: Estado = 'comprobando'
    let reloj = 0
    let ultima = 0
    // Conectado se comprueba cada minuto; sin conexión, cada 4 s, y al volver se avisa a las pantallas
    // que no pudieron cargar para que lo reintenten solas (componentes/Cargando.tsx). Además, sin esperar al minuto:
    // cuando el navegador dice que se ha quedado sin red (offline) o que ha vuelto (online), y cuando una petición
    // no llega al servidor (EVENTO_SIN_RESPUESTA): así el punto verde no dice «conectado» si no lo estás.
    const comprobar = () => {
      clearTimeout(reloj)
      ultima = Date.now()
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        // Sin red no hay nada que preguntar: se marca ya y se vuelve a mirar en 4 s (o al llegar «online»).
        setEstado('sin conexión')
        antes = 'sin conexión'
        reloj = window.setTimeout(comprobar, 4_000)
        return
      }
      pedir<{ ok: boolean }>('/api/salud')
        .then((s) => (s.ok ? 'conectado' : 'sin conexión') as Estado)
        .catch(() => 'sin conexión' as Estado)
        .then((ahora) => {
          if (!vigente) return
          setEstado(ahora)
          if (ahora === 'conectado' && antes === 'sin conexión') window.dispatchEvent(new Event(EVENTO_CONECTADO))
          antes = ahora
          reloj = window.setTimeout(comprobar, ahora === 'conectado' ? 60_000 : 4_000)
        })
      pedir<Alerta[]>('/api/alertas')
        .then((a) => vigente && setAlertas(a))
        .catch(() => undefined)
    }
    comprobar()
    const alVolver = () => document.visibilityState === 'visible' && comprobar()
    // Una petición fallida: se comprueba ya, pero no más de una vez cada 2 s (pueden fallar varias pantallas a la vez).
    const sinRespuesta = () => Date.now() - ultima > 2_000 && comprobar()
    document.addEventListener('visibilitychange', alVolver)
    window.addEventListener('offline', comprobar)
    window.addEventListener('online', comprobar)
    window.addEventListener(EVENTO_SIN_RESPUESTA, sinRespuesta)
    return () => {
      vigente = false
      clearTimeout(reloj)
      document.removeEventListener('visibilitychange', alVolver)
      window.removeEventListener('offline', comprobar)
      window.removeEventListener('online', comprobar)
      window.removeEventListener(EVENTO_SIN_RESPUESTA, sinRespuesta)
    }
  }, [])

  const textoEstado = t(estado === 'comprobando' ? 'sesion.estado.comprobando' : estado === 'conectado' ? 'sesion.estado.conectado' : 'sesion.estado.sinConexion')
  return (
    <header className="sesion">
      {alMenu && (
        <button type="button" className="boton-menu boton-mini" onClick={alMenu} aria-label={t('sesion.menu')}>
          {t('sesion.menuTexto')}
        </button>
      )}
      <button type="button" className="boton-buscar" onClick={() => window.dispatchEvent(new Event('magister-paleta'))} title={t('sesion.buscarTitulo')}>
        <span className="buscar-texto">{t('sesion.buscar')}</span> <kbd>Ctrl K</kbd>
      </button>
      {/* Los avisos, recogidos: un botón con cuántos hay que despliega la lista (antes ocupaban media barra). */}
      <div className="avisos" ref={cajaAvisos}>
        {alertas.length > 0 && (
          <button
            type="button"
            className="avisos-boton"
            aria-expanded={verAvisos}
            aria-label={`${alertas.length} ${alertas.length === 1 ? t('sesion.aviso') : t('sesion.avisos')}`}
            title={t('sesion.avisosTitulo')}
            onClick={() => setVerAvisos(!verAvisos)}
          >
            ⚠ <span>{alertas.length}</span>
          </button>
        )}
        {verAvisos && alertas.length > 0 && (
          <div className="avisos-caja" role="dialog" aria-label={t('sesion.avisosCabeza')}>
            <div className="avisos-cabeza">
              <strong>{t('sesion.avisosCabeza')}</strong>
              <button type="button" className="boton-mini" onClick={() => alertas.forEach((a) => resolver(a.id))}>
                {t('sesion.resolverTodos')}
              </button>
            </div>
            <ul>
              {alertas.map((a) => (
                <li key={a.id}>
                  <p>{a.detalle}</p>
                  <small title={t('sesion.runbookTitulo')}>{t('sesion.queHacer', { runbook: a.runbook })}</small>
                  <button
                    type="button"
                    className="boton-mini"
                    onClick={() => resolver(a.id)}
                    title={sinResolver === a.id ? t('sesion.noResueltaTitulo') : undefined}
                  >
                    {sinResolver === a.id ? t('sesion.noResuelta') : t('sesion.resuelta')}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {/* «Conectado» no dice nada: solo se enseña cuando hay un problema. */}
      {estado === 'sin conexión' && (
        <span className="estado estado-no" title={textoEstado} role="status">
          <span className="estado-texto">{textoEstado}</span>
        </span>
      )}
      <Tomate />
      <Afinar />
    </header>
  )
}
