import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { listarPlanes, pedir, verPlan, type ResumenPlan, type VistaPlan } from '../api.ts'
import Vacio, { irARuta } from '../componentes/Vacio.tsx'

// Vídeo: entender una lección antes de estudiarla. El guion se narra por escenas con la voz del equipo,
// con subtítulos y las diapositivas pasando a la par. Nada de descargar guiones: se ve aquí.

interface Estados {
  [clave: string]: { tipos: Record<string, string>; ids?: Record<string, number> }
}

interface Escena {
  marca: string
  frases: string[]
}

const MARCAS: Record<string, string> = {
  intuicion: 'Intuición',
  choque: 'Choque',
  nombre: 'Nombre',
  teoria: 'Teoría',
  ejemplo: 'Ejemplo',
  cierre: 'Cierre',
  practica: 'Práctica',
}
const nombreMarca = (m: string) => MARCAS[m] ?? m.charAt(0).toUpperCase() + m.slice(1)
const VELOCIDADES = [0.9, 1, 1.15, 1.3]

export function escenas(guion: string): Escena[] {
  const salida: Escena[] = []
  for (const trozo of guion.replace(/^---\n[\s\S]*?\n---\n/, '').split(/(?=\[\[[a-z_]+\]\])/)) {
    const m = trozo.match(/^\[\[([a-z_]+)\]\]\s*([\s\S]*)$/)
    const texto = (m ? m[2] : trozo).replace(/[#*_`>]/g, '').replace(/\s+/g, ' ').trim()
    if (!texto) continue
    const frases = texto.split(/(?<=[.!?…])\s+(?=[A-ZÁÉÍÓÚÑ¿¡0-9])/).filter(Boolean)
    salida.push({ marca: m ? m[1] : 'intro', frases })
  }
  return salida
}

// Una voz en español instalada en el equipo (no de un servicio en la red).
function vozLocal(): SpeechSynthesisVoice | null {
  const voces = window.speechSynthesis?.getVoices() ?? []
  const es = voces.filter((v) => v.lang.toLowerCase().startsWith('es'))
  return es.find((v) => v.localService && v.lang === 'es-ES') ?? es.find((v) => v.localService) ?? null
}

function Reproductor({ titulo, clave, guionId, diaposId }: { titulo: string; clave: string; guionId: number; diaposId?: number }) {
  const [lista, setLista] = useState<Escena[] | null>(null)
  const [paginas, setPaginas] = useState(0)
  const [e, setE] = useState(0)
  const [f, setF] = useState(0)
  const [sonando, setSonando] = useState(false)
  const [velocidad, setVelocidad] = useState(1)
  const [voz, setVoz] = useState<SpeechSynthesisVoice | null>(null)
  const marco = useRef<HTMLIFrameElement | null>(null)
  const turno = useRef(0)

  useEffect(() => {
    pedir<{ texto: string }>(`/api/materiales/${guionId}`).then((m) => setLista(escenas(m.texto)))
    if (diaposId)
      fetch(`/api/materiales/${diaposId}/fichero/html`)
        .then((r) => r.text())
        .then((h) => setPaginas((h.match(/<section[\s>]/g) ?? []).length))
    const cargarVoz = () => setVoz(vozLocal())
    cargarVoz()
    window.speechSynthesis?.addEventListener('voiceschanged', cargarVoz)
    return () => {
      window.speechSynthesis?.removeEventListener('voiceschanged', cargarVoz)
      window.speechSynthesis?.cancel()
    }
  }, [guionId, diaposId])

  // La diapositiva que acompaña a cada escena, repartidas a lo largo del guion.
  const pagina = lista && paginas ? 1 + Math.round((e * (paginas - 1)) / Math.max(1, lista.length - 1)) : 1
  useEffect(() => {
    if (marco.current && diaposId) marco.current.src = `/api/materiales/${diaposId}/fichero/html#${pagina}`
  }, [pagina, diaposId])

  const total = useMemo(() => lista?.reduce((a, x) => a + x.frases.length, 0) ?? 0, [lista])
  const hechas = useMemo(() => (lista ? lista.slice(0, e).reduce((a, x) => a + x.frases.length, 0) + f : 0), [lista, e, f])
  const minutos = useMemo(() => Math.max(1, Math.round((lista?.reduce((a, x) => a + x.frases.join(' ').split(' ').length, 0) ?? 0) / 150)), [lista])

  const decir = useCallback(
    (ie: number, jf: number) => {
      if (!lista) return
      const sintesis = window.speechSynthesis
      sintesis.cancel()
      const mio = ++turno.current
      const frase = lista[ie]?.frases[jf]
      if (!frase) {
        setSonando(false)
        return
      }
      const u = new SpeechSynthesisUtterance(frase)
      u.lang = 'es-ES'
      if (voz) u.voice = voz
      u.rate = velocidad
      u.onend = () => {
        if (mio !== turno.current) return
        const sigF = jf + 1 < lista[ie].frases.length ? jf + 1 : 0
        const sigE = sigF === 0 ? ie + 1 : ie
        if (sigE >= lista.length) {
          setSonando(false)
          return
        }
        setE(sigE)
        setF(sigF)
        decir(sigE, sigF)
      }
      sintesis.speak(u)
    },
    [lista, voz, velocidad],
  )

  const tocar = () => {
    if (sonando) {
      turno.current++
      window.speechSynthesis.cancel()
      setSonando(false)
    } else {
      setSonando(true)
      decir(e, f)
    }
  }
  const irEscena = (k: number) => {
    if (!lista) return
    const n = Math.max(0, Math.min(lista.length - 1, k))
    setE(n)
    setF(0)
    if (sonando) decir(n, 0)
  }

  useEffect(() => {
    const tecla = (ev: KeyboardEvent) => {
      if ((ev.target as HTMLElement).closest('input, select, textarea')) return
      if (ev.key === ' ') {
        ev.preventDefault()
        tocar()
      } else if (ev.key === 'ArrowRight') irEscena(e + 1)
      else if (ev.key === 'ArrowLeft') irEscena(e - 1)
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  })

  if (!lista) return <p className="vacio">Cargando el vídeo…</p>
  const escena = lista[e]

  return (
    <div className="video">
      <div className="video-pantalla">
        {diaposId ? (
          <iframe
            ref={marco}
            title={`Diapositivas de ${clave}`}
            tabIndex={-1}
            onLoad={(ev) => {
              // Mismo origen: se esconde el panel de navegación de Marp, que aquí manda el reproductor.
              const doc = (ev.target as HTMLIFrameElement).contentDocument
              if (doc && !doc.getElementById('sin-osc')) {
                const st = doc.createElement('style')
                st.id = 'sin-osc'
                st.textContent = '.bespoke-marp-osc { display: none !important; }'
                doc.head.appendChild(st)
              }
            }}
          />
        ) : (
          <div className="video-escena">
            <span className="foco-etq">{nombreMarca(escena.marca)}</span>
            <p>{escena.frases[0]}</p>
          </div>
        )}
        <div className="video-subtitulo" aria-live="polite">
          {escena.frases[f]}
        </div>
      </div>
      <div className="video-controles">
        <button className="boton" onClick={() => irEscena(e - 1)} aria-label="Escena anterior">
          ⏮
        </button>
        <button className="boton boton-principal video-tocar" onClick={tocar}>
          {sonando ? '❚❚ Pausa' : hechas > 0 ? '▶ Seguir' : '▶ Ver'}
        </button>
        <button className="boton" onClick={() => irEscena(e + 1)} aria-label="Escena siguiente">
          ⏭
        </button>
        <span className="barra video-barra">
          <span style={{ width: `${total ? (hechas / total) * 100 : 0}%` }} />
        </span>
        <label className="nota">
          Velocidad{' '}
          <select value={velocidad} onChange={(x) => setVelocidad(Number(x.target.value))}>
            {VELOCIDADES.map((v) => (
              <option key={v} value={v}>
                {String(v).replace('.', ',')}×
              </option>
            ))}
          </select>
        </label>
      </div>
      {!voz && <p className="nota">No encuentro una voz en español instalada en tu equipo: se usará la que tenga el navegador.</p>}
      <div className="video-info">
        <h2>
          <span className="bloques-clave">{clave}</span> {titulo}
        </h2>
        <p className="nota">
          {lista.length} escenas · unos {minutos} min · espacio para pausar, ← → para cambiar de escena
        </p>
        <ol className="video-capitulos">
          {lista.map((x, k) => (
            <li key={k}>
              <button className={k === e ? 'actual' : ''} onClick={() => irEscena(k)}>
                <span>{nombreMarca(x.marca)}</span>
                <small>{x.frases[0]}</small>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}

export default function PanelVideo() {
  const [planes, setPlanes] = useState<ResumenPlan[] | null>(null)
  const [plan, setPlan] = useState<VistaPlan | null>(null)
  const [estados, setEstados] = useState<Estados>({})
  const [clave, setClave] = useState<string | null>(null)

  useEffect(() => {
    listarPlanes().then((ps) => {
      setPlanes(ps)
      if (ps[0]) {
        verPlan(ps[0].tema_id).then(setPlan)
        pedir<Estados>(`/api/planes/${ps[0].plan_id}/materiales`).then(setEstados)
      }
    })
  }, [])

  if (planes == null) return <p className="vacio">Cargando…</p>
  if (!plan)
    return (
      <div className="panel">
        <h1>Vídeo</h1>
        <Vacio
          etiqueta="Sin plan todavía"
          titulo="Vídeos para entender antes de estudiar"
          texto="Cada lección con guion se ve aquí como un vídeo corto: diapositivas, voz y subtítulos, por escenas."
          acciones={[{ texto: 'Crear un plan', principal: true, alPulsar: () => irARuta('#/nuevo-plan') }]}
        />
      </div>
    )

  const conVideo = plan.lecciones.filter((l) => estados[l.clave]?.ids?.guion)
  const sinVideo = plan.lecciones.filter((l) => !estados[l.clave]?.ids?.guion)
  const elegida = plan.lecciones.find((l) => l.clave === (clave ?? conVideo[0]?.clave))
  const ids = elegida ? estados[elegida.clave]?.ids : undefined

  return (
    <div className="panel video-panel">
      <h1>Vídeo</h1>
      {elegida && ids?.guion ? (
        <Reproductor key={elegida.clave} titulo={elegida.titulo} clave={elegida.clave} guionId={ids.guion} diaposId={ids.diapositivas} />
      ) : (
        <Vacio
          etiqueta="Sin vídeos todavía"
          titulo="Prepara el guion de una lección"
          texto="Al preparar una lección, marca «Guion de vídeo». Aquí se verá narrado, con subtítulos y sus diapositivas."
        />
      )}
      <section className="pg-seccion">
        <h2>Biblioteca</h2>
        <ul className="video-biblioteca">
          {conVideo.map((l) => (
            <li key={l.clave}>
              <button className={l.clave === elegida?.clave ? 'actual' : ''} onClick={() => setClave(l.clave)}>
                <span className="bloques-clave">{l.clave}</span>
                <span>{l.titulo}</span>
                <small>▶ Ver</small>
              </button>
            </li>
          ))}
          {sinVideo.map((l) => (
            <li key={l.clave} className="sin-video">
              <button onClick={() => irARuta(`#/fichas/${plan.tema_id}/${l.clave}`)}>
                <span className="bloques-clave">{l.clave}</span>
                <span>{l.titulo}</span>
                <small>Preparar guion →</small>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
