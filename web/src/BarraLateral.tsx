import { useState } from 'react'
import { borrarConversacion, type Conversacion } from './api.ts'
import { GRUPOS, type IdModo } from './modos.ts'

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

const CLAVE_PLEGADOS = 'magister-secciones-plegadas'

function leerPlegados(): string[] {
  try {
    const t = localStorage.getItem(CLAVE_PLEGADOS)
    return t ? (JSON.parse(t) as string[]) : GRUPOS.filter((g) => g.plegado).map((g) => g.nombre)
  } catch {
    return GRUPOS.filter((g) => g.plegado).map((g) => g.nombre)
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
  const [plegados, setPlegados] = useState<string[]>(leerPlegados)
  const alternar = (nombre: string) =>
    setPlegados((x) => {
      const nuevo = x.includes(nombre) ? x.filter((y) => y !== nombre) : [...x, nombre]
      try {
        localStorage.setItem(CLAVE_PLEGADOS, JSON.stringify(nuevo))
      } catch {
        /* sin almacenamiento: vale para esta sesión */
      }
      return nuevo
    })
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
          const lista = (
            <ul className="modos">
              {g.modos.map((m) => (
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
          // Una sección plegada se abre sola si estás en uno de sus modos.
          const abierta = !plegados.includes(g.nombre) || g.modos.some((m) => m.id === modoActivo)
          return (
            <div key={g.nombre} className={`grupo-modos ${abierta ? 'abierto' : 'cerrado'}`} data-rama={ig}>
              <button type="button" className="grupo-titulo" aria-expanded={abierta} onClick={() => alternar(g.nombre)}>
                <span>{g.nombre}</span>
                <span className="grupo-flecha" aria-hidden>
                  ›
                </span>
              </button>
              <div className="grupo-cuerpo">
                <div>{lista}</div>
              </div>
            </div>
          )
        })}
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
