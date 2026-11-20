import { useEffect, useRef, useState } from 'react'
import { t } from '../i18n/i18n.ts'
import { usarIdioma } from '../i18n/usarIdioma.ts'
import { cambiarPreferencias, escribirEnChat, idDeModo, todosLosModos, usarPreferencias } from './preferencias.ts'

// ```recordar  -> una instrucción duradera («a partir de ahora...»): se guarda solo si la aceptas.
// ```modo      -> un modo de aprendizaje nuevo: nombre, para qué y sus reglas; se crea solo si lo aceptas.

export function RecordarTarjeta({ texto, completo }: { texto: string; completo: boolean }) {
  const p = usarPreferencias()
  const instruccion = texto.trim().split('\n')[0].replace(/^[-*]\s*/, '').slice(0, 300)
  const [estado, setEstado] = useState<'propuesta' | 'hecho' | 'no'>('propuesta')
  if (!completo || !instruccion) return null
  const ya = p?.instrucciones.includes(instruccion)
  return (
    <div className={`agendar-tarjeta ${estado}`}>
      <span className="test-etq">¿Lo recuerdo para siempre?</span>
      <p className="pregunta-titulo">{instruccion}</p>
      {estado === 'propuesta' && !ya ? (
        <div className="botones">
          <button
            className="boton boton-principal"
            onClick={async () => {
              await cambiarPreferencias({ instrucciones: [...(p?.instrucciones ?? []), instruccion] })
              setEstado('hecho')
            }}
          >
            Recordarlo siempre
          </button>
          <button className="boton-mini" onClick={() => setEstado('no')}>
            Solo en esta conversación
          </button>
        </div>
      ) : estado === 'no' ? (
        <p className="nota">Vale: solo aquí.</p>
      ) : (
        <p className="nota">✓ Lo recordaré en todas las conversaciones. Lo puedes quitar en la mascota de arriba, «Afina a tu tutor».</p>
      )}
    </div>
  )
}

export function leerModo(texto: string) {
  const lineas = texto.split('\n').map((l) => l.trim()).filter(Boolean)
  const campo = (k: string) => lineas.find((l) => l.toLowerCase().startsWith(k + ':'))?.slice(k.length + 1).trim() ?? ''
  return {
    nombre: campo('nombre').slice(0, 60),
    para: campo('para').slice(0, 200),
    reglas: lineas.filter((l) => /^[-*]\s/.test(l)).map((l) => l.replace(/^[-*]\s*/, '').slice(0, 300)).slice(0, 10),
  }
}

export function ModoTarjeta({ texto, completo }: { texto: string; completo: boolean }) {
  const p = usarPreferencias()
  const modo = leerModo(texto)
  const [estado, setEstado] = useState<'propuesta' | 'hecho' | 'activado' | 'no'>('propuesta')
  const [fallo, setFallo] = useState(false)
  // Un modo sin reglas no cambia nada: no se ofrece.
  if (!completo || !modo.nombre || !modo.reglas.length) return null
  // Si ya tienes uno con ese nombre, solo se activa: crearlo otra vez dejaba duplicados (_2) en cada recarga.
  const igual = (s: string) => s.toLowerCase().replace(/\s+/g, '')
  const existente = p ? todosLosModos(p).find((m) => igual(m.nombre) === igual(modo.nombre)) : undefined
  const crear = async (activar: boolean) => {
    setFallo(false)
    try {
      if (!p) throw new Error('sin preferencias')
      const id = idDeModo(modo.nombre, todosLosModos(p).map((m) => m.id))
      await cambiarPreferencias({ modos: [...p.modos, { id, ...modo }], ...(activar ? { modo: id } : {}) })
      setEstado('hecho')
    } catch {
      setFallo(true)
    }
  }
  const activar = async (id: string) => {
    setFallo(false)
    try {
      await cambiarPreferencias({ modo: id })
      setEstado('activado')
    } catch {
      setFallo(true)
    }
  }
  return (
    <div className={`agendar-tarjeta modo-tarjeta ${estado}`}>
      <span className="test-etq">Nuevo modo de aprendizaje</span>
      <p className="pregunta-titulo">{modo.nombre}</p>
      {modo.para && <p className="nota">{modo.para}</p>}
      <ul className="modo-reglas">
        {modo.reglas.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      {estado === 'propuesta' && existente ? (
        <div className="botones">
          <span className="nota">Ya lo tienes.</span>
          <button className="boton boton-principal" onClick={() => activar(existente.id)}>
            Activarlo
          </button>
          <button className="boton-mini" onClick={() => setEstado('no')}>
            Ahora no
          </button>
        </div>
      ) : estado === 'propuesta' ? (
        <div className="botones">
          <button className="boton boton-principal" onClick={() => crear(true)}>
            Crear y activar
          </button>
          <button className="boton" onClick={() => crear(false)}>
            Solo crearlo
          </button>
          <button className="boton-mini" onClick={() => setEstado('no')}>
            Ahora no
          </button>
        </div>
      ) : estado === 'hecho' ? (
        <p className="nota">✓ Creado. Lo cambias con el selector de modo, junto al cuadro de texto.</p>
      ) : estado === 'activado' ? (
        <p className="nota">✓ Activado. Lo cambias con el selector de modo, junto al cuadro de texto.</p>
      ) : (
        <p className="nota">Vale, no lo creo.</p>
      )}
      {fallo && (
        <p className="nota" role="alert">
          {existente && estado === 'propuesta' ? 'No he podido activarlo.' : 'No he podido crearlo.'} Inténtalo de nuevo.
        </p>
      )}
    </div>
  )
}

// En qué idioma contesta el tutor en el chat escrito; la voz, la llamada y el material siguen en español.
export function SelectorIdioma() {
  const p = usarPreferencias()
  usarIdioma()
  if (!p) return null
  const actual = p.idioma ?? 'es'
  return (
    <div className="selector-idioma" role="radiogroup" aria-label={t('modo.idiomaAria')} title={t('modo.idiomaTitulo')}>
      {(
        [
          ['es', 'ES', t('modo.idiomaEs')],
          ['en', 'EN', t('modo.idiomaEn')],
        ] as const
      ).map(([valor, texto, ayuda]) => (
        <button key={valor} type="button" role="radio" aria-checked={actual === valor} title={ayuda} onClick={() => actual !== valor && cambiarPreferencias({ idioma: valor })}>
          {texto}
        </button>
      ))}
    </div>
  )
}

// El selector de modo, junto al cuadro del chat: Normal, los de serie y los tuyos.
export function SelectorModo() {
  const p = usarPreferencias()
  usarIdioma()
  const [abierto, setAbierto] = useState(false)
  // Hacia dónde se abre y cuánto cabe: hacia abajo si hay más sitio debajo (la portada de Estudio libre), hacia arriba
  // si no (la caja de un chat, abajo del todo). La lista se desplaza por dentro si no caben todos.
  const [hueco, setHueco] = useState<{ abajo: boolean; alto: number }>({ abajo: false, alto: 360 })
  const caja = useRef<HTMLDivElement | null>(null)
  const abrir = () => {
    if (!abierto && caja.current) {
      const r = caja.current.getBoundingClientRect()
      const debajo = window.innerHeight - r.bottom - 16
      const encima = r.top - 16
      setHueco({ abajo: debajo >= encima, alto: Math.max(160, Math.min(480, Math.max(debajo, encima) - 8)) })
    }
    setAbierto(!abierto)
  }
  useEffect(() => {
    if (!abierto) return
    const fuera = (e: MouseEvent) => caja.current && !caja.current.contains(e.target as Node) && setAbierto(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setAbierto(false)
    document.addEventListener('mousedown', fuera)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', fuera)
      document.removeEventListener('keydown', esc)
    }
  }, [abierto])
  if (!p) return null
  const modos = todosLosModos(p)
  const actual = modos.find((m) => m.id === p.modo)
  const elegir = (id: string | null) => {
    cambiarPreferencias({ modo: id })
    setAbierto(false)
  }
  return (
    <div className="selector-modo" ref={caja}>
      <button type="button" className={`boton-mini ${actual ? 'activo' : ''}`} aria-expanded={abierto} onClick={abrir} title={actual?.para ?? t('modo.selectorTitulo')}>
        {t('modo.selector', { nombre: actual?.nombre ?? t('modo.normal') })}
      </button>
      {abierto && (
        <div className={`selector-modo-lista ${hueco.abajo ? 'abajo' : ''}`} role="menu" style={{ maxHeight: hueco.alto }}>
          <button role="menuitemradio" aria-checked={!actual} onClick={() => elegir(null)}>
            <strong>{t('modo.normal')}</strong>
            <small>{t('modo.normalAyuda')}</small>
          </button>
          {modos.map((m) => (
            <div key={m.id} className="selector-modo-fila">
              <button role="menuitemradio" aria-checked={m.id === p.modo} onClick={() => elegir(m.id)}>
                <strong>{m.nombre}</strong>
                <small>{m.para}</small>
              </button>
              {p.modos.some((x) => x.id === m.id) && (
                <button
                  className="borrar"
                  aria-label={t('modo.borrar', { nombre: m.nombre })}
                  onClick={() => {
                    if (!confirm(t('modo.confirmarBorrar', { nombre: m.nombre }))) return
                    cambiarPreferencias({ modos: p.modos.filter((x) => x.id !== m.id), ...(p.modo === m.id ? { modo: null } : {}) })
                  }}
                >
                  ×
                </button>
              )}
            </div>
          ))}
          <button
            className="selector-modo-crear"
            onClick={() => {
              setAbierto(false)
              escribirEnChat(t('modo.crearTexto'))
            }}
          >
            {t('modo.crearTuyo')}
          </button>
        </div>
      )}
    </div>
  )
}
