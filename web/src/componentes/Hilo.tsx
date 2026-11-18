import Pensando from './Pensando.tsx'
import { Children, isValidElement, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import Markdown, { type Components } from './Markdown.tsx'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { Diagrama, Opciones, TestRapido } from './Interactivo.tsx'
import { conKatex, tieneMates, usarKatex } from './katexPerezoso.ts'
import { AgendarTarjeta, PreguntaTarjeta } from './Preguntas.tsx'
import { ModoTarjeta, RecordarTarjeta } from './Modos.tsx'
import Revelar from './Revelar.tsx'
import type { CitaInfo } from '../api.ts'
import { conMarcas, PanelCita } from '../Cita.tsx'
import Valorar from './Valorar.tsx'
import Acciones, { type AccionArnes } from './Acciones.tsx'
import { ACEPTA, type Adjunto } from './usarAdjuntos.ts'
import { BotonGuardar, GuardarMarcado, usarGuardadas } from './GuardarNota.tsx'

export interface Burbuja {
  clave: string
  rol: 'usuario' | 'tutor'
  contenido: string
  estado: 'completo' | 'interrumpido' | 'error' | 'llegando'
  tiempos?: { primero: number | null; total: number }
  citas?: CitaInfo[]
  traza?: string
  voto?: boolean | null
  sinFuentes?: boolean
  acciones?: AccionArnes[]
  // Dijiste «guárdalo»: la respuesta anterior acaba de ir a Mis notas.
  notaGuardada?: boolean
  // Marcado «esto no cuenta para el tutor».
  noCuenta?: boolean
}

interface Props {
  burbujas: Burbuja[]
  escribiendo: boolean
  alEnviar: (texto: string) => void
  alParar: () => void
  placeholder?: string
  pie?: ReactNode
  deshabilitado?: boolean
  // Adjuntar ficheros: si se pasa, sale el clip y se puede arrastrar sobre la caja.
  alAdjuntar?: (ficheros: File[]) => void
  adjuntos?: Adjunto[]
  alQuitarAdjunto?: (nombre: string) => void
  // Lo que está haciendo el tutor («Buscando en tus fuentes»): va dentro de la burbuja que espera.
  fase?: string | null
  // Estudio libre: cada respuesta se puede guardar en Mis notas, entera o el trozo que marques.
  guardable?: boolean
}

const ESTADO_ADJUNTO: Record<Adjunto['estado'], string> = {
  subiendo: 'subiendo…',
  indexando: 'leyéndolo…',
  listo: 'listo: el tutor ya lo usa',
  error: 'no se pudo leer',
}

// El texto del tutor. Los componentes de Markdown se fijan por burbuja (useMemo): si se crearan en cada
// fotograma mientras el texto aparece, los diagramas y los tests se volverían a montar sin parar.
function CuerpoTutor({
  b,
  escribiendo,
  alEnviar,
  alCita,
}: {
  b: Burbuja
  escribiendo: boolean
  alEnviar: (texto: string) => void
  alCita: (c: { id: number; info: CitaInfo | undefined }) => void
}) {
  const completo = b.estado !== 'llegando'
  const componentes = useMemo<Components>(
    () => ({
      // ```test, ```opciones y ```svg se convierten en botones y dibujos.
      pre: ({ children }) => {
        const hijo = Children.toArray(children)[0]
        if (isValidElement<{ className?: string; children?: ReactNode }>(hijo)) {
          const clase = hijo.props.className ?? ''
          const texto = String(hijo.props.children ?? '')
          if (clase.includes('language-test')) return <TestRapido texto={texto} completo={completo} />
          if (clase.includes('language-svg')) return <Diagrama svg={texto} completo={completo} />
          if (clase.includes('language-pregunta'))
            return <PreguntaTarjeta texto={texto} completo={completo} alResponder={escribiendo ? undefined : alEnviar} />
          if (clase.includes('language-agendar')) return <AgendarTarjeta texto={texto} completo={completo} />
          if (clase.includes('language-recordar')) return <RecordarTarjeta texto={texto} completo={completo} />
          if (clase.includes('language-modo')) return <ModoTarjeta texto={texto} completo={completo} />
          if (clase.includes('language-opciones')) return <Opciones texto={texto} activo={completo && !escribiendo} alElegir={alEnviar} />
          // De las llamadas: los conceptos que apuntó el tutor y el apartado que enseñó en la pizarra.
          if (clase.includes('language-concepto'))
            return (
              <dl className="conceptos-llamada">
                {texto
                  .split('\n')
                  .map((l) => l.replace(/^[-*\s]+/, '').match(/^\*{0,2}([^:]{2,60}?)\*{0,2}\s*:\s*(.+)$/))
                  .filter((m): m is RegExpMatchArray => !!m)
                  .map((m) => (
                    <div key={m[1]}>
                      <dt>{m[1]}</dt>
                      <dd>{m[2]}</dd>
                    </div>
                  ))}
              </dl>
            )
          if (clase.includes('language-ficha')) return <p className="nota">En la pizarra: el apartado {texto.trim()} de tus apuntes.</p>
        }
        return <pre>{children}</pre>
      },
      a: ({ href, children }) => {
        const m = href?.match(/^#cita-(\d+)$/)
        if (!m)
          return (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          )
        const id = Number(m[1])
        const info = b.citas?.find((c) => c.fragmento_id === id)
        return (
          <button
            type="button"
            className={info?.dudosa ? 'marca-cita cita-dudosa' : 'marca-cita'}
            title={info?.dudosa ? 'Cita dudosa: compruébala' : 'Ver la fuente'}
            onClick={() => alCita({ id, info })}
          >
            {id}
            {info?.dudosa ? '?' : ''}
          </button>
        )
      },
    }),
    [b.citas, completo, escribiendo, alEnviar, alCita],
  )
  const katex = usarKatex(tieneMates(b.contenido))
  return (
    <Revelar texto={conMarcas(b.contenido)} animar={b.estado === 'llegando'}>
      {(visible) => (
        <Markdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={conKatex(katex)} components={componentes}>
          {visible}
        </Markdown>
      )}
    </Revelar>
  )
}

// El hilo de una conversación: lo usan Estudio libre, el diagnóstico y la sesión de tutor.
export default function Hilo({
  burbujas,
  escribiendo,
  alEnviar,
  alParar,
  placeholder,
  pie,
  deshabilitado,
  alAdjuntar,
  adjuntos,
  alQuitarAdjunto,
  fase,
  guardable = false,
}: Props) {
  const guardadas = usarGuardadas(guardable)
  const zonaMensajes = useRef<HTMLDivElement>(null)
  const [encima, setEncima] = useState(false)
  const [borrador, setBorrador] = useState('')
  const caja = useRef<HTMLTextAreaElement>(null)
  const final = useRef<HTMLDivElement>(null)
  const [cita, setCita] = useState<{ id: number; info?: CitaInfo } | null>(null)

  const pegado = useRef(true)

  // La caja crece sola con lo que escribes, hasta un límite; a partir de ahí, se desplaza por dentro.
  useEffect(() => {
    const c = caja.current
    if (!c) return
    c.style.height = 'auto'
    c.style.height = `${Math.min(c.scrollHeight, 220)}px`
  }, [borrador])

  // Otras partes (el selector de modo) pueden dejarte un texto empezado en el cuadro.
  useEffect(() => {
    const al = (e: Event) => {
      setBorrador((e as CustomEvent<string>).detail)
      window.setTimeout(() => {
        const c = caja.current
        if (c) {
          c.focus()
          c.setSelectionRange(c.value.length, c.value.length)
        }
      }, 0)
    }
    window.addEventListener('magister-escribir', al)
    return () => window.removeEventListener('magister-escribir', al)
  }, [])

  useEffect(() => {
    const zona = final.current?.closest('.central')
    if (!zona) return
    const alDesplazar = () => {
      pegado.current = zona.scrollTop + zona.clientHeight >= zona.scrollHeight - 160
    }
    zona.addEventListener('scroll', alDesplazar, { passive: true })
    return () => zona.removeEventListener('scroll', alDesplazar)
  }, [])

  // Sigue al texto mientras crece (también cuando aparece a ritmo de lectura) hasta el fondo de verdad,
  // por debajo de la caja de escribir. Si subes para releer, deja de seguir hasta que vuelvas abajo.
  useEffect(() => {
    const zona = final.current?.closest('.central')
    const lista = final.current?.closest('.hilo')
    if (!zona || !lista) return
    const seguir = () => {
      if (pegado.current) zona.scrollTo({ top: zona.scrollHeight })
    }
    const obs = new ResizeObserver(seguir)
    obs.observe(lista)
    return () => obs.disconnect()
  }, [])

  useEffect(() => {
    const ultima = burbujas[burbujas.length - 1]
    // Al enviar tú un mensaje, siempre abajo.
    if (ultima?.rol === 'usuario') pegado.current = true
  }, [burbujas])

  const mandar = () => {
    const texto = borrador.trim()
    if (!texto || escribiendo || deshabilitado) return
    setBorrador('')
    alEnviar(texto)
    caja.current?.focus()
  }

  const alTeclear = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      mandar()
    }
  }

  return (
    <div className="hilo">
      <div className="mensajes" aria-live="polite" aria-busy={escribiendo} ref={zonaMensajes}>
        {guardable && <GuardarMarcado zona={zonaMensajes} />}
        {/* Clave por posición: al acabar, la burbuja cambia de id y no debe volver a montarse (cortaría el texto que aparece). */}
        {burbujas.map((b, i) => {
          const mid = b.clave.startsWith('m-') ? Number(b.clave.slice(2)) : null
          return (
          <div key={i} className={`burbuja burbuja-${b.rol} burbuja-${b.estado}`} data-mensaje={mid ?? undefined}>
            {b.notaGuardada && (
              <p className="aviso-nota">
                Guardado en <a href="#/notas">Mis notas</a>
              </p>
            )}
            {b.rol === 'tutor' && b.estado === 'llegando' && !b.contenido ? (
              <Pensando texto={fase ? `${fase}…` : 'Pensando…'} />
            ) : b.estado === 'error' ? (
              <p role="alert">{b.contenido}</p>
            ) : b.rol === 'tutor' ? (
              <CuerpoTutor b={b} escribiendo={escribiendo} alEnviar={alEnviar} alCita={setCita} />
            ) : (
              <p className="propio">{b.contenido}</p>
            )}
            {b.rol === 'usuario' && b.noCuenta && (
              <small className="nota" title="Lo marcaste como «esto no cuenta para el tutor»: no entra en tu perfil">
                No cuenta
              </small>
            )}
            {b.estado === 'interrumpido' && <small className="nota">Interrumpido</small>}
            {b.acciones && b.acciones.length > 0 && b.estado === 'completo' && <Acciones acciones={b.acciones} />}
            {guardable && b.rol === 'tutor' && b.estado === 'completo' && mid != null && b.contenido.trim() && (
              <BotonGuardar mensajeId={mid} texto={b.contenido} guardada={guardadas.has(mid)} />
            )}
            {b.rol === 'tutor' && b.traza && b.estado === 'completo' && (
              <Valorar traza={b.traza} inicial={b.voto ?? null} alPedirOtra={escribiendo ? undefined : alEnviar} />
            )}
          </div>
          )
        })}
        <div ref={final} />
      </div>
      {cita && <PanelCita id={cita.id} info={cita.info} alCerrar={() => setCita(null)} />}
      {pie}
      <form
        className={`entrada entrada-hilo ${encima ? 'soltar' : ''}`}
        onDragOver={(e) => {
          if (!alAdjuntar) return
          e.preventDefault()
          setEncima(true)
        }}
        onDragLeave={() => setEncima(false)}
        onDrop={(e) => {
          if (!alAdjuntar) return
          e.preventDefault()
          setEncima(false)
          alAdjuntar(Array.from(e.dataTransfer.files))
        }}
        onSubmit={(e) => {
          e.preventDefault()
          mandar()
        }}
      >
        {adjuntos && adjuntos.length > 0 && (
          <ul className="adjuntos">
            {adjuntos.map((a) => (
              <li key={a.nombre} className={`adjunto ${a.estado}`} title={a.detalle ?? ''}>
                <span className="adjunto-icono" aria-hidden>
                  {a.estado === 'listo' ? '✓' : a.estado === 'error' ? '!' : '…'}
                </span>
                <span className="adjunto-nombre">{a.nombre}</span>
                <small>{ESTADO_ADJUNTO[a.estado]}</small>
                {alQuitarAdjunto && (
                  <button type="button" aria-label={`Quitar ${a.nombre}`} onClick={() => alQuitarAdjunto(a.nombre)}>
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {alAdjuntar && (
          <label className="adjuntar" title="Adjuntar PDF, Markdown, HTML o texto (también puedes arrastrarlos aquí)" aria-label="Adjuntar un fichero">
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden>
              <path d="M10 4.5v11M4.5 10h11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            <input
              type="file"
              hidden
              multiple
              accept={ACEPTA}
              onChange={(e) => {
                alAdjuntar(Array.from(e.target.files ?? []))
                e.target.value = ''
              }}
            />
          </label>
        )}
        <textarea
          ref={caja}
          rows={1}
          value={borrador}
          onChange={(e) => setBorrador(e.target.value)}
          onKeyDown={alTeclear}
          placeholder={placeholder ?? 'Escribe tu mensaje (Mayúsculas + Intro para saltar de línea)'}
          aria-label="Tu mensaje"
          disabled={deshabilitado}
        />
        {escribiendo ? (
          <button type="button" className="boton" onClick={alParar}>
            Parar
          </button>
        ) : (
          <button type="submit" className="boton boton-principal" disabled={!borrador.trim() || deshabilitado}>
            Enviar
          </button>
        )}
      </form>
    </div>
  )
}
