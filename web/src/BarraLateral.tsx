import { borrarConversacion, type Conversacion } from './api.ts'
import { MODOS, type IdModo } from './modos.ts'

interface Props {
  modoActivo: IdModo
  alElegir: (modo: IdModo) => void
  conversaciones: Conversacion[]
  activa: number | null
  alElegirConversacion: (id: number | null) => void
  alCambiar: () => void
}

export default function BarraLateral({
  modoActivo,
  alElegir,
  conversaciones,
  activa,
  alElegirConversacion,
  alCambiar,
}: Props) {
  return (
    <aside className="lateral">
      <div className="marca">Magister</div>

      <nav aria-label="Modos">
        <ul className="modos">
          {MODOS.map((m) => (
            <li key={m.id}>
              {/* Un botón desactivado no se puede pulsar ni enfocar con el teclado. */}
              <button
                type="button"
                className="modo"
                disabled={!m.encendido}
                aria-current={m.id === modoActivo ? 'page' : undefined}
                onClick={() => alElegir(m.id)}
              >
                <span>{m.nombre}</span>
                {!m.encendido && <span className="pronto">próximamente</span>}
              </button>
            </li>
          ))}
        </ul>
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
