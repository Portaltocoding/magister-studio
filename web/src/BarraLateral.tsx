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
    <aside className="lateral">
      <div className="marca">
        <span>Magister</span>
        {alCerrar && (
          <button type="button" className="boton-plegar" onClick={alCerrar} aria-label="Plegar la barra lateral" title="Plegar (Ctrl+B o Esc)">
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden>
              <rect x="2.5" y="3.5" width="15" height="13" rx="3" fill="none" stroke="currentColor" strokeWidth="1.4" />
              <line x1="7.5" y1="3.5" x2="7.5" y2="16.5" stroke="currentColor" strokeWidth="1.4" />
            </svg>
          </button>
        )}
      </div>

      <nav aria-label="Modos" className="grupos-modos">
        {GRUPOS.map((g) => {
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
            <div key={g.nombre} className={`grupo-modos ${abierta ? 'abierto' : 'cerrado'}`}>
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
