import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { enviarCodigoCuenta, guardarBienvenida, iniciarCuenta, probarCuenta } from '../api.ts'
import Mascota, { type GestoMascota } from '../Mascota.tsx'
import { cambiarPreferencias } from './preferencias.ts'
import { Locutor } from './voz.ts'
import {
  codigoLimpio,
  codigoPosible,
  CUENTA_INICIAL,
  enlaceSeguro,
  fraseDePrueba,
  limpiarNombre,
  pasosDe,
  posicion,
  reducirCuenta,
  RUTA_APUNTES,
  RUTA_PLAN,
  siguiente,
  textoMascota,
  TITULOS,
  type Modo,
  type Paso,
} from './bienvenida.ts'

interface Props {
  modo: Modo
  nombre: string
  cuentaConectada: boolean
  alCerrar: () => void
}

const mensajeDe = (e: unknown) => (e instanceof Error ? e.message : 'Algo ha fallado. Prueba otra vez.')

// La mascota te recibe en pocos pasos: cómo te llama, tu cuenta de Claude (sin terminal), una prueba, tu primer plan y
// tus apuntes. La lógica (qué pasos, cuándo se saltan, la conexión) está en bienvenida.ts; esto solo pinta y llama a la API.
export default function Bienvenida({ modo, nombre: nombreInicial, cuentaConectada, alCerrar }: Props) {
  const pasos = pasosDe(modo, cuentaConectada)
  const [paso, setPaso] = useState<Paso>(pasos[0])
  const [nombre, setNombre] = useState(nombreInicial)
  const [gesto, setGesto] = useState<GestoMascota>('hablando')
  const caja = useRef<HTMLDivElement>(null)
  const { n, de } = posicion(pasos, paso)

  useEffect(() => {
    caja.current?.focus()
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && omitir()
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const cerrar = useCallback(
    async (estado: 'hecha' | 'omitida', ir?: string) => {
      // Si no se puede guardar, se cierra igual: lo peor es que vuelva a salir.
      if (modo === 'completa') await guardarBienvenida(estado).catch(() => undefined)
      alCerrar()
      if (ir) window.location.hash = ir
    },
    [modo, alCerrar],
  )
  const omitir = () => void cerrar('omitida')
  const avanzar = () => {
    const sig = siguiente(pasos, paso)
    if (sig) setPaso(sig)
    else void cerrar('hecha')
  }

  return (
    <div className="bienvenida-velo">
      <div className="bienvenida" role="dialog" aria-modal="true" aria-labelledby="bienvenida-titulo" tabIndex={-1} ref={caja}>
        <Mascota gesto={gesto} />
        <p className="bienvenida-habla" aria-live="polite">
          {textoMascota(paso, nombre, modo)}
        </p>
        <p className="bienvenida-paso">
          Paso {n} de {de}
        </p>
        <h2 id="bienvenida-titulo">{TITULOS[paso]}</h2>

        {paso === 'nombre' && (
          <PasoNombre
            nombre={nombre}
            alCambiar={setNombre}
            alSeguir={async () => {
              const limpio = limpiarNombre(nombre)
              if (limpio) await cambiarPreferencias({ nombre: limpio }).catch(() => undefined)
              avanzar()
            }}
          />
        )}
        {paso === 'cuenta' && <PasoCuenta alGesto={setGesto} alConectada={avanzar} />}
        {paso === 'prueba' && <PasoPrueba nombre={nombre} alGesto={setGesto} alSeguir={avanzar} alVolverACuenta={() => setPaso('cuenta')} />}
        {paso === 'plan' && (
          <div className="bienvenida-botones">
            <button type="button" className="boton boton-principal" onClick={() => void cerrar('hecha', RUTA_PLAN)}>
              Crear mi plan
            </button>
            <button type="button" className="boton" onClick={avanzar}>
              Ahora no
            </button>
          </div>
        )}
        {paso === 'apuntes' && (
          <div className="bienvenida-botones">
            <button type="button" className="boton boton-principal" onClick={() => void cerrar('hecha', RUTA_APUNTES)}>
              Subir apuntes o PDF
            </button>
            <button type="button" className="boton" onClick={() => void cerrar('hecha')}>
              Ahora no
            </button>
          </div>
        )}

        <button type="button" className="bienvenida-saltar" onClick={omitir}>
          {modo === 'reconectar' ? 'Ahora no' : 'Saltar la bienvenida'}
        </button>
      </div>
    </div>
  )
}

function PasoNombre({ nombre, alCambiar, alSeguir }: { nombre: string; alCambiar: (n: string) => void; alSeguir: () => void }) {
  return (
    <form
      className="bienvenida-botones"
      onSubmit={(e) => {
        e.preventDefault()
        alSeguir()
      }}
    >
      <input
        className="bienvenida-campo"
        value={nombre}
        maxLength={60}
        autoFocus
        placeholder="Tu nombre"
        aria-label="Tu nombre"
        autoComplete="given-name"
        onChange={(e) => alCambiar(e.target.value)}
      />
      <button type="submit" className="boton boton-principal">
        {limpiarNombre(nombre) ? 'Seguir' : 'Prefiero no decirlo'}
      </button>
    </form>
  )
}

// Conectar la cuenta de Claude sin terminal: el servidor da el enlace, se abre en otra pestaña y se pega aquí el código.
function PasoCuenta({ alGesto, alConectada }: { alGesto: (g: GestoMascota) => void; alConectada: () => void }) {
  const [e, enviar] = useReducer(reducirCuenta, CUENTA_INICIAL)
  const [codigo, setCodigo] = useState('')

  useEffect(() => {
    alGesto(e.fase === 'abriendo' || e.fase === 'enviando' ? 'pensando' : e.fase === 'codigo' ? 'escuchando' : 'hablando')
  }, [e.fase, alGesto])

  const conectar = async () => {
    enviar({ tipo: 'pulsar' })
    try {
      const { enlace } = await iniciarCuenta()
      if (!enlaceSeguro(enlace)) throw new Error('No he recibido un enlace de Claude válido. Prueba otra vez.')
      // Algunos navegadores bloquean abrir pestañas tras una espera: por eso el enlace también se ofrece como botón.
      window.open(enlace, '_blank', 'noopener')
      enviar({ tipo: 'enlace', enlace })
    } catch (x) {
      enviar({ tipo: 'fallo', mensaje: mensajeDe(x) })
    }
  }
  const mandar = async () => {
    enviar({ tipo: 'enviar' })
    try {
      await enviarCodigoCuenta(codigoLimpio(codigo))
      enviar({ tipo: 'conectada' })
      setCodigo('')
      alConectada()
    } catch (x) {
      enviar({ tipo: 'fallo', mensaje: mensajeDe(x) })
    }
  }
  const otraVez = () => {
    setCodigo('')
    enviar({ tipo: 'reiniciar' })
  }

  if (e.fase === 'error')
    return (
      <>
        <p className="bienvenida-error" role="alert">
          {e.error}
        </p>
        <div className="bienvenida-botones">
          <button type="button" className="boton boton-principal" onClick={otraVez}>
            Probar otra vez
          </button>
        </div>
      </>
    )
  if (e.fase === 'codigo' || e.fase === 'enviando')
    return (
      <form
        className="bienvenida-codigo"
        onSubmit={(ev) => {
          ev.preventDefault()
          if (codigoPosible(codigo) && e.fase === 'codigo') void mandar()
        }}
      >
        <ol className="bienvenida-pasos">
          <li>
            En la pestaña de Claude, inicia sesión y pulsa «Authorize». Si no se ha abierto,{' '}
            <a href={e.enlace ?? '#'} target="_blank" rel="noopener noreferrer">
              ábrela aquí
            </a>
            .
          </li>
          <li>Claude te enseñará un código. Cópialo y pégalo aquí.</li>
        </ol>
        <input
          className="bienvenida-campo"
          value={codigo}
          autoFocus
          spellCheck={false}
          autoComplete="off"
          placeholder="Pega aquí el código"
          aria-label="Código de Claude"
          disabled={e.fase === 'enviando'}
          onChange={(ev) => setCodigo(ev.target.value)}
        />
        <div className="bienvenida-botones">
          <button type="submit" className="boton boton-principal" disabled={!codigoPosible(codigo) || e.fase === 'enviando'}>
            {e.fase === 'enviando' ? 'Conectando…' : 'Conectar'}
          </button>
          <button type="button" className="boton" onClick={otraVez} disabled={e.fase === 'enviando'}>
            Empezar de nuevo
          </button>
        </div>
      </form>
    )
  return (
    <div className="bienvenida-botones">
      <button type="button" className="boton boton-principal" onClick={() => void conectar()} disabled={e.fase === 'abriendo'}>
        {e.fase === 'abriendo' ? 'Preparando el enlace…' : 'Conectar con Claude'}
      </button>
    </div>
  )
}

// La mascota saluda con la voz y una llamada mínima al modelo confirma que la cuenta funciona.
function PasoPrueba({
  nombre,
  alGesto,
  alSeguir,
  alVolverACuenta,
}: {
  nombre: string
  alGesto: (g: GestoMascota) => void
  alSeguir: () => void
  alVolverACuenta: () => void
}) {
  type Fase = 'listo' | 'probando' | 'bien' | 'mal'
  const [fase, setFase] = useState<Fase>('listo')
  const [fallo, setFallo] = useState<{ mensaje: string; cuenta: boolean } | null>(null)
  const locutor = useRef<Locutor | null>(null)

  useEffect(() => () => locutor.current?.parar(), [])
  useEffect(() => {
    alGesto(fase === 'probando' ? 'pensando' : 'hablando')
  }, [fase, alGesto])

  const probar = async () => {
    setFase('probando')
    setFallo(null)
    // Se pulsa un botón antes: el navegador deja sonar la voz.
    try {
      locutor.current ??= new Locutor()
      locutor.current.nueva()
      locutor.current.decir(fraseDePrueba(nombre))
      locutor.current.cerrar()
    } catch {
      /* sin voz en este navegador: la prueba sigue */
    }
    try {
      const r = await probarCuenta()
      if (r.ok) setFase('bien')
      else {
        setFallo({ mensaje: r.mensaje, cuenta: r.cuenta })
        setFase('mal')
      }
    } catch (x) {
      setFallo({ mensaje: mensajeDe(x), cuenta: true })
      setFase('mal')
    }
  }

  return (
    <>
      {fase === 'bien' && (
        <p className="bienvenida-ok" role="status">
          Todo funciona: te oigo, me oyes y Claude contesta.
        </p>
      )}
      {fase === 'mal' && fallo && (
        <p className="bienvenida-error" role="alert">
          {fallo.mensaje}
        </p>
      )}
      <div className="bienvenida-botones">
        {fase === 'bien' ? (
          <button type="button" className="boton boton-principal" onClick={alSeguir}>
            Seguir
          </button>
        ) : (
          <button type="button" className="boton boton-principal" onClick={() => void probar()} disabled={fase === 'probando'}>
            {fase === 'probando' ? 'Probando…' : fase === 'mal' ? 'Probar otra vez' : 'Hacer la prueba'}
          </button>
        )}
        {fase === 'mal' && fallo && !fallo.cuenta && (
          <button type="button" className="boton" onClick={alVolverACuenta}>
            Conectar la cuenta
          </button>
        )}
        {fase === 'mal' && (
          <button type="button" className="boton" onClick={alSeguir}>
            Seguir igualmente
          </button>
        )}
      </div>
    </>
  )
}
