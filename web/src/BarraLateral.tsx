import { useState } from 'react'
import { borrarConversacion, type Conversacion } from './api.ts'
import { GRUPOS, TALLER, type IdModo } from './modos.ts'

interface Props {
  modoActivo: IdModo
  alElegir: (modo: IdModo) => void
  conversaciones: Conversacion[]
  activa: number | null
  alElegirConversacion: (id: number | null) => void
  alCambiar: () => void
  alCerrar?: () => void
  fija?: boolean
  // Plegada y fuera de pantalla: ni Tab ni lector de pantalla entran en ella.
  oculta?: boolean
  alFijar?: (si: boolean) => void
}

// Las secciones plegadas se recuerdan en este navegador.
const CLAVE_PLEGADAS = 'magister-secciones-plegadas'
function leerPlegadas(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(CLAVE_PLEGADAS) ?? '[]')
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

export default function BarraLateral({
  modoActivo,
  alElegir,
  conversaciones,
  activa,
  alElegirConversacion,
  alCambiar,
  alCerrar,
  fija = false,
  oculta = false,
  alFijar,
}: Props) {
  const [plegadas, setPlegadas] = useState<string[]>(leerPlegadas)
  const plegar = (nombre: string, si: boolean) => {
    const nuevas = si ? [...plegadas.filter((n) => n !== nombre), nombre] : plegadas.filter((n) => n !== nombre)
    setPlegadas(nuevas)
    try {
      localStorage.setItem(CLAVE_PLEGADAS, JSON.stringify(nuevas))
    } catch {
      /* sin almacenamiento: vale para esta sesión */
    }
  }
  return (
    <aside className="lateral" inert={oculta}>
      <div className="marca">
        <button type="button" className="marca-nombre" onClick={() => alElegir('libre')} title="Estudio libre">
          Magister
        </button>
        {alFijar && (
          <button
            type="button"
            className={`boton-plegar boton-fijar ${fija ? 'activo' : ''}`}
            onClick={() => alFijar(!fija)}
            aria-pressed={fija}
            aria-label={fija ? 'Soltar la barra lateral' : 'Fijar la barra lateral'}
            title={fija ? 'Soltar: vuelve a plegarse y se abre por encima' : 'Fijar: se queda siempre abierta a la izquierda'}
          >
            <svg viewBox="0 0 20 20" width="17" height="17" aria-hidden>
              <path d="M7.5 3.5h5l-.8 4.2 2.8 2.8H5.5l2.8-2.8z" fill={fija ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
              <line x1="10" y1="10.5" x2="10" y2="16.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        )}
        {alCerrar && !fija && (
          <button type="button" className="boton-plegar" onClick={alCerrar} aria-label="Plegar la barra lateral" title="Plegar (Ctrl+B o Esc)">
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden>
              <rect x="2.5" y="3.5" width="15" height="13" rx="3" fill="none" stroke="currentColor" strokeWidth="1.4" />
              <line x1="7.5" y1="3.5" x2="7.5" y2="16.5" stroke="currentColor" strokeWidth="1.4" />
            </svg>
          </button>
        )}
      </div>

      <nav aria-label="Modos" className="grupos-modos">
        {GRUPOS.map((g, ig) => {
          // Las que se abren desde dentro de su pantalla (Tutor, desde Hoy) no se listan aquí.
          const visibles = g.modos.filter((m) => !m.soloDentro)
          // Una entrada con una sola subsección que se llama igual (Hoy) no la repite debajo.
          const sola = visibles.length === 1 && visibles[0].nombre === g.nombre
          const lista = (
            <ul className="modos">
              {visibles.map((m) => (
                <li key={m.id}>
                  {/* Un botón desactivado no se puede pulsar ni enfocar con el teclado. */}
                  <button
                    type="button"
                    className="modo"
                    disabled={!m.encendido}
                    title={m.ayuda}
                    aria-current={m.id === modoActivo ? 'page' : undefined}
                    onClick={() => alElegir(m.id)}
                  >
                    <span>{m.nombre}</span>
                    {!m.encendido && <span className="pronto">pronto</span>}
                  </button>
                </li>
              ))}
            </ul>
          )
          if (!g.nombre)
            return (
              <div key="inicio" className="grupo-modos grupo-inicio">
                {lista}
              </div>
            )
          // Cada entrada, con sus subsecciones debajo unidas por una línea.
          // Se puede plegar con la flecha; al entrar por su nombre se despliega.
          const dentro = g.modos.some((m) => m.id === modoActivo)
          const plegada = plegadas.includes(g.nombre)
          const idLista = `seccion-${ig}`
          return (
            <div key={g.nombre} className={`grupo-modos grupo-entrada ${dentro ? 'dentro' : ''} ${plegada ? 'plegada' : ''}`} data-orden={ig}>
              <div className="entrada-fila">
                <button
                  type="button"
                  className="entrada"
                  title={g.ayuda}
                  onClick={() => {
                    if (plegada) plegar(g.nombre, false)
                    alElegir(g.modos[0].id)
                  }}
                >
                  {g.nombre}
                </button>
                {!sola && (
                <button
                  type="button"
                  className="plegar-seccion"
                  aria-expanded={!plegada}
                  aria-controls={idLista}
                  aria-label={plegada ? `Desplegar ${g.nombre}` : `Plegar ${g.nombre}`}
                  title={plegada ? 'Desplegar' : 'Plegar'}
                  onClick={() => plegar(g.nombre, !plegada)}
                >
                  <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden>
                    <path d="M3 4.5 L6 7.5 L9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                )}
              </div>
              {!plegada && !sola && <div id={idLista}>{lista}</div>}
            </div>
          )
        })}
        <button type="button" className={`enlace-taller ${TALLER.some((m) => m.id === modoActivo) ? 'actual' : ''}`} onClick={() => alElegir('etiquetar')} title="Para calibrar Magister: tono, banco de preguntas y animaciones">
          Taller
        </button>
      </nav>

      <section className="conversaciones">
        <div className="cabecera-seccion">
          <h2>Conversaciones</h2>
          <button type="button" className="boton-mini" onClick={() => alElegirConversacion(null)}>
            Nueva
          </button>
        </div>
        {conversaciones.length === 0 ? (
          <p className="vacio">Aún no tienes conversaciones.</p>
        ) : (
          <ul className="modos">
            {conversaciones.map((c) => (
              <li key={c.id} className="fila-conversacion">
                <button
                  type="button"
                  className="modo"
                  aria-current={c.id === activa && modoActivo === 'libre' ? 'page' : undefined}
                  onClick={() => alElegirConversacion(c.id)}
                  title={c.titulo}
                >
                  <span className="recorte">{c.titulo}</span>
                </button>
                <button
                  type="button"
                  className="borrar"
                  aria-label={`Borrar ${c.titulo}`}
                  onClick={async () => {
                    if (!confirm(`¿Borrar «${c.titulo}»?`)) return
                    await borrarConversacion(c.id)
                    if (c.id === activa) alElegirConversacion(null)
                    alCambiar()
                  }}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  )
}
