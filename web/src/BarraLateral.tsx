import { MODOS, type IdModo } from './modos.ts'

interface Props {
  modoActivo: IdModo
  alElegir: (modo: IdModo) => void
}

export default function BarraLateral({ modoActivo, alElegir }: Props) {
  return (
    <aside className="lateral">
      <div className="marca">Magister</div>

      <input
        className="buscar"
        type="search"
        placeholder="Buscar · próximamente"
        aria-label="Buscar (próximamente)"
        disabled
      />

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

      <section className="temas">
        <h2>Tus temas</h2>
        <p className="vacio">Aún no tienes temas.</p>
      </section>
    </aside>
  )
}
