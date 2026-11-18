import { useState } from 'react'
import Aprendido from '../componentes/Aprendido.tsx'
import Colores from '../componentes/Colores.tsx'
import ControlVoz from '../componentes/ControlVoz.tsx'
import { avisosActivos, EXTRAS, GRUPOS } from '../componentes/Afinar.tsx'
import { cambiarPreferencias, todosLosModos, usarPreferencias, type PreferenciasTutor } from '../componentes/preferencias.ts'
import { elegirTema, temaGuardado, TEMAS, type Tema } from '../componentes/tema.ts'
import { aplicarTamano, tamanoGuardado, TAMANOS, type IdTamano } from '../componentes/escala.ts'
import Mascota, { elegirForma, FORMAS, usarForma } from '../Mascota.tsx'
import Cargando from '../componentes/Cargando.tsx'

// Los ajustes de Magister, todos juntos: cómo te explica el tutor, lo que recuerda de ti, el aspecto, la voz y los
// avisos. La mascota de la barra se queda con los rápidos (longitud, nivel, estilo, extras y modo).

// Muestra en pequeño de cada aspecto: el fondo, la letra y sus colores.
const MUESTRAS: Record<Tema, { fondo: string; texto: string; colores: string[] }> = {
  clasico: { fondo: '#f6f5f2', texto: '#2b2a28', colores: ['#2b2a28', '#8d8a83', '#cfccc5'] },
  riso: { fondo: '#fffbf3', texto: '#3a3330', colores: ['#ee5a4f', '#3d8ee6', '#ffc93d', '#2fae66'] },
}

export default function PanelAjustes() {
  const p = usarPreferencias()
  const forma = usarForma()
  const [tema, setTema] = useState<Tema>(temaGuardado)
  const [tamano, setTamano] = useState<IdTamano>(tamanoGuardado)
  const [nueva, setNueva] = useState('')
  const [guardado, setGuardado] = useState(false)
  const [avisos, setAvisos] = useState(() => 'Notification' in window && Notification.permission === 'granted' && avisosActivos())

  const cambiar = async (cambio: Partial<PreferenciasTutor>) => {
    await cambiarPreferencias(cambio)
    setGuardado(true)
    window.setTimeout(() => setGuardado(false), 1500)
  }

  return (
    <div className="panel ajustes">
      <div className="ajustes-cabeza">
        <h1>Ajustes</h1>
        <small className={`ajustes-guardado ${guardado ? 'visible' : ''}`} role="status">
          ✓ Guardado
        </small>
      </div>
      <p className="nota">Lo rápido también está en la mascota de arriba: púlsala y cambia el tono sin salir de donde estás.</p>

      <section className="ajustes-seccion">
        <h2>Cómo te explica</h2>
        <p className="nota">Se aplica desde tu próximo mensaje.</p>
        {!p ? (
          <Cargando />
        ) : (
          <>
            <div className="ajustes-filas">
              {GRUPOS.map((g) => (
                <div key={g.campo} className="afinar-grupo">
                  <span>{g.titulo}</span>
                  <div className="afinar-segmentos" role="radiogroup" aria-label={g.titulo}>
                    {g.opciones.map(([valor, texto]) => (
                      <button
                        key={valor}
                        type="button"
                        role="radio"
                        aria-checked={p[g.campo] === valor}
                        onClick={() => cambiar({ [g.campo]: valor } as Partial<PreferenciasTutor>)}
                      >
                        {texto}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <div className="afinar-grupo">
                <span>Modo</span>
                <select id="ajustes-modo" value={p.modo ?? ''} onChange={(e) => cambiar({ modo: e.target.value || null })} aria-label="Modo de aprendizaje">
                  <option value="">Normal</option>
                  {todosLosModos(p).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nombre}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="afinar-extras">
              {EXTRAS.map((x) => (
                <label key={x.campo}>
                  <input type="checkbox" checked={p[x.campo]} onChange={(e) => cambiar({ [x.campo]: e.target.checked } as Partial<PreferenciasTutor>)} />
                  {x.texto}
                </label>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="ajustes-seccion">
        <h2>Lo que recuerda de ti</h2>
        <p className="nota">Instrucciones que el tutor tiene siempre en cuenta.</p>
        {p && (
          <>
            {p.instrucciones.length ? (
              <ul className="afinar-recuerda">
                {p.instrucciones.map((x, i) => (
                  <li key={i}>
                    <span>{x}</span>
                    <button className="borrar" aria-label="Olvidar esto" onClick={() => cambiar({ instrucciones: p.instrucciones.filter((_, k) => k !== i) })}>
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="nota">Nada aún.</p>
            )}
            <form
              className="afinar-anadir"
              onSubmit={(e) => {
                e.preventDefault()
                if (!nueva.trim()) return
                cambiar({ instrucciones: [...p.instrucciones, nueva.trim()] })
                setNueva('')
              }}
            >
              <input id="ajustes-instruccion" value={nueva} onChange={(e) => setNueva(e.target.value)} placeholder="Ej.: los ejemplos de código, en Python" aria-label="Nueva instrucción" />
              <button className="boton-mini" disabled={!nueva.trim()}>
                Añadir
              </button>
            </form>
          </>
        )}
        <Aprendido />
      </section>

      <section className="ajustes-seccion">
        <h2>Aspecto</h2>
        <div className="ajustes-temas" role="radiogroup" aria-label="Aspecto">
          {TEMAS.map((t) => {
            const m = MUESTRAS[t.id]
            return (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={tema === t.id}
                className={`ajustes-tema ${tema === t.id ? 'elegida' : ''}`}
                onClick={() => {
                  elegirTema(t.id)
                  setTema(t.id)
                }}
              >
                <span className="ajustes-tema-muestra" style={{ background: m.fondo, color: m.texto }} aria-hidden>
                  <b>Aa</b>
                  <span>
                    {m.colores.map((c) => (
                      <i key={c} style={{ background: c }} />
                    ))}
                  </span>
                </span>
                <strong>{t.nombre}</strong>
                <small>{t.descripcion}</small>
              </button>
            )
          })}
        </div>
        <div className="afinar-grupo">
          <span>Tamaño de la interfaz</span>
          <div className="afinar-segmentos" role="radiogroup" aria-label="Tamaño de la interfaz">
            {TAMANOS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={tamano === t.id}
                onClick={() => {
                  aplicarTamano(t.id)
                  setTamano(t.id)
                }}
              >
                {t.nombre}
              </button>
            ))}
          </div>
        </div>
        <div className="afinar-grupo">
          <span>Mascota</span>
          <div className="afinar-mascotas" role="radiogroup" aria-label="Mascota">
            {FORMAS.map((f) => (
              <button key={f.id} type="button" role="radio" aria-checked={forma === f.id} onClick={() => elegirForma(f.id)}>
                <Mascota forma={f.id} mini />
                {f.nombre}
              </button>
            ))}
          </div>
        </div>
        <div className="ajustes-fila-botones">
          <Colores clase="boton" />
          <button type="button" className="boton" onClick={() => (window.location.hash = '#/animaciones')}>
            Ver las animaciones de espera
          </button>
        </div>
      </section>

      <section className="ajustes-seccion">
        <h2>Voz</h2>
        <p className="nota">La velocidad y la voz del tutor, en la llamada y al leer en voz alta.</p>
        <ControlVoz />
        <div className="ajustes-fila-botones">
          <button type="button" className="boton" onClick={() => (window.location.hash = '#/pronunciacion')}>
            Cómo pronuncia los términos técnicos
          </button>
        </div>
      </section>

      <section className="ajustes-seccion">
        <h2>Avisos</h2>
        <label className="afinar-avisos">
          <input
            type="checkbox"
            checked={avisos}
            onChange={async (e) => {
              if (!('Notification' in window)) return
              if (e.target.checked && Notification.permission !== 'granted') await Notification.requestPermission()
              const si = e.target.checked && Notification.permission === 'granted'
              try {
                localStorage.setItem('magister-avisos', si ? 'si' : 'no')
              } catch {
                /* sin almacenamiento */
              }
              setAvisos(si)
            }}
          />
          Avisarme cuando empiece una sesión y al acabar cada pomodoro
        </label>
      </section>
    </div>
  )
}
