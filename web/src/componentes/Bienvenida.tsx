import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { enviarCodigoCuenta, guardarBienvenida, iniciarCuenta, probarCuenta } from '../api.ts'
import Mascota, { type GestoMascota } from '../Mascota.tsx'
import { cambiarPreferencias } from './preferencias.ts'
import { Locutor } from './voz.ts'
import { IDIOMAS, fijarIdioma, t, traducir, type Idioma } from '../i18n/i18n.ts'
import { usarIdioma } from '../i18n/usarIdioma.ts'
import {
  codigoLimpio,
  codigoPosible,
  enlaceSeguro,
  fraseDePrueba,
  inicialCuenta,
  limpiarNombre,
  pasosDe,
  pasosConexion,
  posicion,
  reducirCuenta,
  resultadoClaude,
  resultadoVoz,
  RUTA_APUNTES,
  RUTA_PLAN,
  siguiente,
  textoMascota,
  tituloDe,
  trasLaPrueba,
  type Modo,
  type Paso,
  type Resultado,
} from './bienvenida.ts'

interface Props {
  modo: Modo
  nombre: string
  cuentaConectada: boolean
  // false sin pty (desarrollo en Windows): no se ofrece conectar ni cambiar la cuenta.
  puedeConectar?: boolean
  alCerrar: () => void
}

const mensajeDe = (e: unknown) => (e instanceof Error ? e.message : t('bienvenida.error.generico'))

// La mascota te recibe en pocos pasos: cómo te llama, tu cuenta de Claude (sin terminal), una prueba, tu primer plan y
// tus apuntes. La lógica (qué pasos, cuándo se saltan, la conexión) está en bienvenida.ts; esto solo pinta y llama a la API.
export default function Bienvenida({ modo, nombre: nombreInicial, cuentaConectada, puedeConectar = true, alCerrar }: Props) {
  const { idioma } = usarIdioma() // la bienvenida vuelve a pintarse al elegir idioma
  const pasos = pasosDe(modo)
  const [paso, setPaso] = useState<Paso>(pasos[0])
  const [conectada, setConectada] = useState(cuentaConectada)
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
      // Al terminar la bienvenida de primera vez se aterriza en Estudio libre (salvo que se pida otra pantalla).
      if (ir) window.location.hash = ir
      else if (modo === 'completa') window.location.hash = '#/libre'
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
        <div className="bienvenida-progreso">
          <div className="bienvenida-puntos" aria-hidden="true">
            {pasos.map((p, i) => (
              <span key={p} className={`bienvenida-punto${i + 1 < n ? ' hecho' : i + 1 === n ? ' actual' : ''}`} />
            ))}
          </div>
          <p className="bienvenida-paso">
            {paso === 'idioma' ? traducir('es', 'bienvenida.paso', { n, de }) : t('bienvenida.paso', { n, de })}
          </p>
        </div>
        <Mascota gesto={gesto} />
        <h2 id="bienvenida-titulo">{tituloDe(paso, idioma)}</h2>
        <p className="bienvenida-habla" aria-live="polite">
          {textoMascota(paso, nombre, modo, idioma)}
        </p>

        {paso === 'idioma' && <PasoIdioma alSeguir={avanzar} />}
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
        {paso === 'cuenta' && <PasoCuenta conectada={conectada} puede={puedeConectar} alGesto={setGesto} alSeguir={avanzar} alConectada={() => setConectada(true)} />}
        {paso === 'prueba' && (
          <PasoPrueba
            nombre={nombre}
            modo={modo}
            alGesto={setGesto}
            alSeguir={avanzar}
            alVolverACuenta={() => {
              setConectada(false)
              setPaso('cuenta')
            }}
          />
        )}
        {paso === 'plan' && (
          <div className="bienvenida-botones">
            <button type="button" className="boton boton-principal" onClick={() => void cerrar('hecha', RUTA_PLAN)}>
              {t('bienvenida.plan.crear')}
            </button>
            <button type="button" className="boton" onClick={avanzar}>
              {t('bienvenida.ahoraNo')}
            </button>
          </div>
        )}
        {paso === 'apuntes' && (
          <div className="bienvenida-botones">
            <button type="button" className="boton boton-principal" onClick={() => void cerrar('hecha', RUTA_APUNTES)}>
              {t('bienvenida.apuntes.subir')}
            </button>
            <button type="button" className="boton" onClick={() => void cerrar('hecha')}>
              {t('bienvenida.ahoraNo')}
            </button>
          </div>
        )}

        <button type="button" className="bienvenida-saltar" onClick={omitir}>
          {paso === 'idioma' ? traducir('es', 'bienvenida.saltar') : modo === 'reconectar' ? t('bienvenida.ahoraNo') : t('bienvenida.saltar')}
        </button>
      </div>
    </div>
  )
}

// El primer paso: el idioma de la pantalla, de lo que dice la mascota, de la voz y del tutor. Al pulsar se guarda y se pasa
// al siguiente paso.
function PasoIdioma({ alSeguir }: { alSeguir: () => void }) {
  const elegir = (i: Idioma) => {
    fijarIdioma(i)
    void cambiarPreferencias({ idioma: i }).catch(() => undefined)
    alSeguir()
  }
  return (
    <>
      <div className="bienvenida-botones bienvenida-idiomas" role="radiogroup" aria-label="Idioma / Language">
        {IDIOMAS.map((i) => (
          <button
            key={i.id}
            type="button"
            role="radio"
            aria-checked={false}
            autoFocus={i.id === 'es'}
            className="boton bienvenida-idioma"
            onClick={() => elegir(i.id)}
          >
            <span className="bienvenida-sigla" aria-hidden="true">
              {i.id.toUpperCase()}
            </span>
            {i.nombre}
          </button>
        ))}
      </div>
      <p className="bienvenida-nota">{t('bienvenida.idioma.nota')}</p>
    </>
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
        placeholder={t('bienvenida.nombre.placeholder')}
        aria-label={t('bienvenida.nombre.placeholder')}
        autoComplete="given-name"
        onChange={(e) => alCambiar(e.target.value)}
      />
      <button type="submit" className="boton boton-principal">
        {limpiarNombre(nombre) ? t('bienvenida.seguir') : t('bienvenida.nombre.prefiero')}
      </button>
    </form>
  )
}

// La cuenta de Claude: siempre se ve cuál está conectada. Para conectar (o cambiar) sin terminal, el servidor da el enlace,
// se abre en otra pestaña y se pega aquí el código.
function PasoCuenta({
  conectada,
  puede,
  alGesto,
  alSeguir,
  alConectada,
}: {
  conectada: boolean
  puede: boolean
  alGesto: (g: GestoMascota) => void
  alSeguir: () => void
  alConectada: () => void
}) {
  const [e, enviar] = useReducer(reducirCuenta, undefined, () => inicialCuenta(conectada, puede))
  const [codigo, setCodigo] = useState('')

  useEffect(() => {
    alGesto(e.fase === 'abriendo' || e.fase === 'enviando' ? 'pensando' : e.fase === 'codigo' ? 'escuchando' : 'hablando')
  }, [e.fase, alGesto])

  const conectar = async () => {
    enviar({ tipo: 'pulsar' })
    try {
      const { enlace } = await iniciarCuenta()
      if (!enlaceSeguro(enlace)) throw new Error(t('bienvenida.error.enlace'))
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

  if (e.fase === 'conectada')
    return (
      <>
        <p className="bienvenida-ok" role="status">
          {t('bienvenida.cuenta.conectada')}
        </p>
        <p>{t('bienvenida.cuenta.suscripcion')}</p>
        <div className="bienvenida-botones">
          <button type="button" className="boton boton-principal" onClick={alSeguir}>
            {t('bienvenida.seguir')}
          </button>
          {puede && (
            <button type="button" className="boton boton-discreto" onClick={() => enviar({ tipo: 'otra' })}>
              {t('bienvenida.cuenta.otra')}
            </button>
          )}
        </div>
      </>
    )
  if (e.fase === 'lista')
    return (
      <>
        <p className="bienvenida-ok" role="status">
          {t('bienvenida.cuenta.lista')}
        </p>
        <div className="bienvenida-botones">
          <button type="button" className="boton boton-principal" onClick={alSeguir}>
            {t('bienvenida.seguir')}
          </button>
        </div>
      </>
    )
  if (e.fase === 'sinpty')
    return (
      <>
        <p>{t('bienvenida.cuenta.sinPty')}</p>
        <div className="bienvenida-botones">
          {conectada ? (
            <button type="button" className="boton boton-principal" onClick={() => enviar({ tipo: 'volver' })}>
              {t('bienvenida.cuenta.volver')}
            </button>
          ) : (
            <button type="button" className="boton boton-principal" onClick={alSeguir}>
              {t('bienvenida.seguir')}
            </button>
          )}
        </div>
      </>
    )
  if (e.fase === 'error')
    return (
      <>
        <p className="bienvenida-error" role="alert">
          {e.error}
        </p>
        <div className="bienvenida-botones">
          <button type="button" className="boton boton-principal" onClick={otraVez}>
            {t('bienvenida.cuenta.otraVez')}
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
            {t('bienvenida.cuenta.yaAbierto1')}{' '}
            <a href={e.enlace ?? '#'} target="_blank" rel="noopener noreferrer">
              {t('bienvenida.cuenta.pulsaAqui')}
            </a>
            .
          </li>
          <li>{t('bienvenida.cuenta.paso2')}</li>
          <li>{t('bienvenida.cuenta.paso3')}</li>
        </ol>
        <input
          className="bienvenida-campo"
          value={codigo}
          autoFocus
          spellCheck={false}
          autoComplete="off"
          placeholder={t('bienvenida.cuenta.pegaCodigo')}
          aria-label={t('bienvenida.cuenta.codigoClaude')}
          disabled={e.fase === 'enviando'}
          onChange={(ev) => setCodigo(ev.target.value)}
        />
        <div className="bienvenida-botones">
          <button type="submit" className="boton boton-principal" disabled={!codigoPosible(codigo) || e.fase === 'enviando'}>
            {e.fase === 'enviando' ? t('bienvenida.cuenta.conectando') : t('bienvenida.cuenta.conectar')}
          </button>
          <button type="button" className="boton" onClick={otraVez} disabled={e.fase === 'enviando'}>
            {t('bienvenida.cuenta.empezar')}
          </button>
        </div>
      </form>
    )
  return (
    <>
      <ol className="bienvenida-pasos">
        {pasosConexion().map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ol>
      {e.fase === 'abriendo' && (
        <p role="status" aria-live="polite">
          {t('bienvenida.cuenta.preparandoTexto')}
        </p>
      )}
      <div className="bienvenida-botones">
        <button type="button" className="boton boton-principal" onClick={() => void conectar()} disabled={e.fase === 'abriendo'}>
          {e.fase === 'abriendo' ? t('bienvenida.cuenta.preparando') : t('bienvenida.cuenta.abrir')}
        </button>
      </div>
    </>
  )
}

// La mascota saluda con la voz y una llamada mínima al modelo confirma que la cuenta funciona.
function PasoPrueba({
  nombre,
  modo,
  alGesto,
  alSeguir,
  alVolverACuenta,
}: {
  nombre: string
  modo: Modo
  alGesto: (g: GestoMascota) => void
  alSeguir: () => void
  alVolverACuenta: () => void
}) {
  type Fase = 'listo' | 'probando' | 'bien' | 'mal'
  const [fase, setFase] = useState<Fase>('listo')
  const [voz, setVoz] = useState<Resultado | null>(null)
  const [claude, setClaude] = useState<Resultado | null>(null)
  const [cuentaFalla, setCuentaFalla] = useState(false)
  const locutor = useRef<Locutor | null>(null)

  useEffect(() => () => locutor.current?.parar(), [])
  useEffect(() => {
    alGesto(fase === 'probando' ? 'pensando' : 'hablando')
  }, [fase, alGesto])

  const probar = async () => {
    setFase('probando')
    setVoz(null)
    setClaude(null)
    setCuentaFalla(false)
    // Se pulsa un botón antes: el navegador deja sonar la voz.
    let pudoHablar = true
    try {
      locutor.current ??= new Locutor()
      locutor.current.nueva()
      locutor.current.decir(fraseDePrueba(nombre))
      locutor.current.cerrar()
    } catch {
      pudoHablar = false
    }
    const v = resultadoVoz(pudoHablar)
    setVoz(v)
    let c: Resultado
    try {
      const r = await probarCuenta()
      c = resultadoClaude(r)
      setCuentaFalla(!r.ok && !r.cuenta)
    } catch {
      c = resultadoClaude({ ok: false, cuenta: true })
    }
    setClaude(c)
    setFase(v.ok && c.ok ? 'bien' : 'mal')
  }

  const linea = (r: Resultado | null, espera: string) =>
    r ? (
      <li className={r.ok ? 'bienvenida-ok' : 'bienvenida-error'}>
        {r.ok ? '✓ ' : '✗ '}
        {r.texto}
      </li>
    ) : (
      <li>{espera}</li>
    )

  return (
    <>
      {fase !== 'listo' && (
        <ul className="bienvenida-pasos" role="status" aria-live="polite">
          {linea(voz, t('bienvenida.prueba.vozProbando'))}
          {linea(claude, t('bienvenida.prueba.claudeProbando'))}
        </ul>
      )}
      {fase === 'bien' && <p>{trasLaPrueba(modo)}</p>}
      <div className="bienvenida-botones">
        {fase === 'bien' ? (
          <button type="button" className="boton boton-principal" onClick={alSeguir}>
            {t('bienvenida.seguir')}
          </button>
        ) : (
          <button type="button" className="boton boton-principal" onClick={() => void probar()} disabled={fase === 'probando'}>
            {fase === 'probando' ? t('bienvenida.prueba.probando') : fase === 'mal' ? t('bienvenida.cuenta.otraVez') : t('bienvenida.prueba.hacer')}
          </button>
        )}
        {fase === 'mal' && cuentaFalla && (
          <button type="button" className="boton" onClick={alVolverACuenta}>
            {t('bienvenida.prueba.conectar')}
          </button>
        )}
        {fase === 'mal' && (
          <button type="button" className="boton" onClick={alSeguir}>
            {t('bienvenida.prueba.igualmente')}
          </button>
        )}
      </div>
    </>
  )
}
