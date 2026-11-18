import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { pedir, rutaExamen } from '../api.ts'
import Mascota from '../Mascota.tsx'
import type { IdModo } from '../modos.ts'
import { irARuta } from '../componentes/Vacio.tsx'
import { tituloSencillo, usarIndice } from '../componentes/indice.tsx'
import PanelPractica from './PanelPractica.tsx'
import { cargarLeccion, FocoLeccion, leerAvance, saludo, type Hoy, type Leccion } from './PanelTutor.tsx'

// El tutor que te guía: te recibe, te dice qué toca y te lleva de la mano por los repasos, las lecciones
// en foco y el examen, comentando entre paso y paso. Lo que está hecho lo sabe el servidor (repasos que quedan,
// sesiones marcadas, examen aprobado); en el navegador solo se recuerda lo que hoy has decidido saltar.

type Tipo = 'tema' | 'repasos' | 'leccion' | 'examen'

interface Paso {
  id: string
  tipo: Tipo
  titulo: string
  detalle: string
  hecho: boolean
  clave?: string
  material_id?: number | null
  sesion_id?: number
  horas?: number
}

const hoyIso = () => new Date().toISOString().slice(0, 10)
const claveDia = () => `magister-tutor-${hoyIso()}`

interface Dia {
  saltados: string[]
  repasosHechos: boolean
}
function leerDia(): Dia {
  try {
    return { saltados: [], repasosHechos: false, ...JSON.parse(localStorage.getItem(claveDia()) ?? '{}') }
  } catch {
    return { saltados: [], repasosHechos: false }
  }
}
function guardarDia(d: Dia) {
  try {
    localStorage.setItem(claveDia(), JSON.stringify(d))
  } catch {
    /* sin almacenamiento */
  }
}

const horasTexto = (h: number) => {
  if (h < 1) return `${Math.round(h * 60)} min`
  return `${String(Math.round(h * 10) / 10).replace('.', ',')} h`
}

// Une una lista en castellano: «a, b y c».
const unir = (xs: string[]) => (xs.length < 2 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`)

function pasosDe(hoy: Hoy, minutos: number | null, dia: Dia, titulo: (clave: string, largo: string) => string): Paso[] {
  const pasos: Paso[] = []
  for (const t of hoy.temas ?? [])
    pasos.push({ id: `tema-${t.clave}`, tipo: 'tema', titulo: `Recordar entera ${titulo(t.clave, t.titulo)}`, detalle: 'repaso del tema, de memoria', hecho: false, clave: t.clave })
  if (hoy.repasos > 0 || dia.repasosHechos)
    pasos.push({
      id: 'repasos',
      tipo: 'repasos',
      titulo: hoy.repasos > 0 ? `Repasar ${hoy.repasos} ${hoy.repasos === 1 ? 'concepto' : 'conceptos'}` : 'Repasos',
      detalle: hoy.repasos > 0 ? `unos ${minutos ?? hoy.repasos * 2} min` : 'hechos',
      hecho: hoy.repasos === 0,
    })
  // La lección atrasada (si la hay) va primero; luego las del día.
  const dia_ = hoy.dia ?? []
  if (hoy.leccion_clave && hoy.estado !== 'adelantar' && !dia_.some((s) => s.clave === hoy.leccion_clave))
    pasos.push({
      id: `leccion-${hoy.leccion_clave}`,
      tipo: 'leccion',
      titulo: titulo(hoy.leccion_clave, hoy.titulo ?? ''),
      detalle: `${hoy.leccion_clave} · ${horasTexto(hoy.horas ?? 0)} · atrasada`,
      hecho: false,
      clave: hoy.leccion_clave,
      material_id: hoy.estado === 'sin_preparar' ? null : (hoy.material_id ?? null),
      sesion_id: hoy.sesion_id,
      horas: hoy.horas,
    })
  for (const s of dia_)
    pasos.push({
      id: `leccion-${s.clave}`,
      tipo: 'leccion',
      titulo: titulo(s.clave, s.titulo),
      detalle: `${s.clave} · ${horasTexto(s.horas)}`,
      hecho: s.estado === 'hecha',
      clave: s.clave,
      material_id: s.material_id ?? null,
      sesion_id: s.sesion_id,
      horas: s.horas,
    })
  if (hoy.examen)
    pasos.push({
      id: 'examen',
      tipo: 'examen',
      titulo: hoy.examen.titulo,
      detalle: `${hoy.examen.preguntas} preguntas · ${hoy.examen.minutos} min`,
      hecho: !!hoy.examen.hecho,
    })
  return pasos
}

// Lo que dice el tutor, según cómo va el día. Sin modelo: se lee al instante.
function frase(pasos: Paso[], actual: Paso | undefined, hoy: Hoy, comentario: string | null): string {
  const pendientes = pasos.filter((p) => !p.hecho)
  const hechos = pasos.filter((p) => p.hecho)
  if (hoy.estado === 'sin_plan' && !pasos.length)
    return `${saludo()}. Empezamos de cero: dime qué quieres aprender y te monto el plan, con sus lecciones y su calendario. Mientras, puedes preguntarme lo que quieras en Estudio libre.`
  if (!pasos.length)
    return hoy.titulo && hoy.estado === 'adelantar'
      ? `${saludo()}. Hoy no te toca nada. Si te apetece, adelantamos ${hoy.leccion_clave}; si no, descansa, que también cuenta.`
      : `${saludo()}. Hoy no te toca nada: descansa, que también cuenta.`
  if (!actual) return `${comentario ? `${comentario} ` : ''}Todo hecho por hoy. Buen trabajo: mañana te lo pregunto justo antes de que se te olvide.`
  const queda = (p: Paso) => {
    if (p.tipo === 'repasos') return `${p.titulo.toLowerCase()} (${p.detalle})`
    if (p.tipo === 'leccion') {
      const av = p.material_id ? leerAvance(p.material_id) : null
      return `«${p.titulo}»${av ? `, que la dejaste en la idea ${av.i + 1}` : ''}`
    }
    if (p.tipo === 'examen') return `el ${p.titulo}`
    return p.titulo.charAt(0).toLowerCase() + p.titulo.slice(1)
  }
  if (!hechos.length && !comentario) {
    // Corto: lo primero y lo que viene después; el resto está en la lista de abajo.
    const primeros = pendientes.slice(0, 2).map(queda)
    const mas = pendientes.length - primeros.length
    const lista = mas > 0 ? `${primeros.join(' y luego ')}, y ${mas === 1 ? 'una cosa más' : `${mas} cosas más`}` : unir(primeros)
    return `${saludo()}. Hoy empezamos con ${lista}. Vamos paso a paso y te acompaño en cada uno. ¿Empezamos?`
  }
  const siguiente = actual.tipo === 'repasos' ? 'los repasos' : actual.tipo === 'examen' ? `el ${actual.titulo}` : queda(actual)
  const resto = pendientes.length - 1
  return `${comentario ? `${comentario} ` : ''}Ahora toca ${siguiente}.${resto > 0 ? ` Después, ${resto === 1 ? 'un paso más' : `${resto} pasos más`}.` : ' Es lo último de hoy.'}`
}

type EnCurso = { tipo: 'repasos' } | { tipo: 'leccion'; leccion: Leccion; paso: Paso }

export default function PanelGuia({ irA }: { irA: (m: IdModo) => void }) {
  const [hoy, setHoy] = useState<Hoy | null>(null)
  const [minutos, setMinutos] = useState<number | null>(null)
  const [dia, setDia] = useState<Dia>(leerDia)
  const [enCurso, setEnCurso] = useState<EnCurso | null>(null)
  const [comentario, setComentario] = useState<string | null>(null)
  const [abriendo, setAbriendo] = useState(false)
  // El paso ampliado en la lista: un clic lo amplía y otro entra. Sin elegir, el que toca ahora.
  const [elegido, setElegido] = useState<string | null>(null)
  const indice = usarIndice(hoy?.plan_id)

  const cargar = useCallback(() => {
    pedir<Hoy>('/api/hoy').then(setHoy)
    pedir<{ minutos: number }[]>('/api/practica/cola').then((c) => setMinutos(Math.round(c.reduce((a, x) => a + x.minutos, 0))))
  }, [])
  useEffect(cargar, [cargar])

  const cambiarDia = (d: Dia) => {
    setDia(d)
    guardarDia(d)
  }

  if (!hoy) return <p className="vacio">Preparando…</p>

  if (enCurso?.tipo === 'repasos')
    return (
      <div className="guia-en-curso">
        <PanelPractica
          irA={irA}
          guiada={{
            alAcabar: (hechas) => {
              setEnCurso(null)
              if (hechas > 0) cambiarDia({ ...dia, repasosHechos: true })
              setComentario(hechas > 0 ? `Hecho: ${hechas} ${hechas === 1 ? 'repaso' : 'repasos'}.` : null)
              cargar()
            },
          }}
        />
      </div>
    )

  if (enCurso?.tipo === 'leccion')
    return (
      <FocoLeccion
        key={enCurso.leccion.material_id}
        leccion={enCurso.leccion}
        sesionId={enCurso.paso.sesion_id}
        horas={enCurso.paso.horas}
        repasos={hoy.repasos}
        inicial={leerAvance(enCurso.leccion.material_id)}
        irA={irA}
        alSalir={() => {
          const av = leerAvance(enCurso.leccion.material_id)
          setEnCurso(null)
          setComentario(av ? `Lo dejamos en la idea ${av.i + 1}; luego seguimos desde ahí.` : '¡Lección hecha!')
          cargar()
        }}
      />
    )

  const titulo = (clave: string, largo: string) => tituloSencillo(indice, clave, largo)
  const pasos = pasosDe(hoy, minutos, dia, titulo)
  const actual = pasos.find((p) => !p.hecho && !dia.saltados.includes(p.id))
  const n = actual ? pasos.indexOf(actual) + 1 : pasos.length

  const empezar = async (p: Paso) => {
    if (p.tipo === 'repasos') return setEnCurso({ tipo: 'repasos' })
    if (p.tipo === 'tema') return irA('repaso')
    if (p.tipo === 'examen') return hoy.examen?.plan_id && irARuta(rutaExamen(hoy.examen.plan_id, hoy.examen))
    if (p.tipo === 'leccion' && p.material_id) {
      setAbriendo(true)
      try {
        setEnCurso({ tipo: 'leccion', leccion: await cargarLeccion(p.material_id), paso: p })
      } finally {
        setAbriendo(false)
      }
    }
  }
  const saltar = (p: Paso) => {
    cambiarDia({ ...dia, saltados: [...dia.saltados, p.id] })
    setComentario('Vale, eso lo dejamos para otro día.')
  }

  const boton = (p: Paso) => {
    if (p.tipo === 'leccion' && !p.material_id) return 'Prepararla'
    if (p.tipo === 'leccion') {
      const av = leerAvance(p.material_id!)
      return av ? `Seguir por la idea ${av.i + 1}` : 'Empezar en modo foco'
    }
    if (p.tipo === 'repasos') return 'Empezar los repasos'
    if (p.tipo === 'examen') return 'Hacer el examen'
    return 'Ir al repaso del tema'
  }

  const entrar = (p: Paso) => (p.tipo === 'leccion' && !p.material_id ? irARuta(`#/fichas/${hoy.tema_id}/${p.clave}`) : empezar(p))
  const ampliado = pasos.find((p) => p.id === (elegido ?? actual?.id)) ?? null
  // Un clic amplía; otro clic en el ampliado entra (si hay algo en lo que entrar).
  const pulsar = (p: Paso) => {
    if (ampliado?.id !== p.id) return setElegido(p.id)
    if (!p.hecho || p.tipo === 'leccion') void entrar(p)
  }
  const mover = (d: number) => {
    if (!pasos.length) return
    const i = ampliado ? pasos.indexOf(ampliado) : -1
    setElegido(pasos[Math.max(0, Math.min(pasos.length - 1, i + d))].id)
  }
  // Lo que dice el tutor sobre el paso ampliado, si no es el que toca ahora.
  const sobre = (p: Paso): string => {
    const av = p.tipo === 'leccion' && p.material_id ? leerAvance(p.material_id) : null
    if (p.hecho) return `«${p.titulo}» ya está hecho.${p.tipo === 'leccion' ? ' Si quieres repasarlo, otro clic y entramos.' : ''}`
    if (dia.saltados.includes(p.id)) return `«${p.titulo}» lo dejamos para otro día. Si te apetece, lo retomamos.`
    if (p.tipo === 'leccion' && !p.material_id) return `«${p.titulo}» aún no tiene apuntes: otro clic y la preparamos.`
    return `${p.titulo} (${p.detalle})${av ? `: la dejaste en la idea ${av.i + 1}` : ''}. Otro clic y entramos.`
  }
  const dice = ampliado && actual && ampliado.id !== actual.id ? sobre(ampliado) : frase(pasos, actual, hoy, comentario)

  return (
    <div className="guia">
      <aside className="guia-lado">
        <div className={`guia-mascota ${abriendo ? 'pensando' : ''}`}>
          <Mascota gesto={abriendo ? 'pensando' : 'hablando'} lugar="tutor" />
        </div>
        <div className="guia-bocadillo" role="status">
          <span className="vacio-etq">Tu tutor</span>
          {/* La clave hace que cada frase nueva entre con un fundido suave. */}
          <p key={dice}>{dice}</p>
          {!actual && hoy.estado === 'sin_plan' && (
            <div className="vacio-acciones">
              <button className="boton boton-principal" onClick={() => irARuta('#/nuevo-plan')}>
                Crear mi plan
              </button>
              <button className="boton" onClick={() => irA('libre')}>
                Estudio libre
              </button>
            </div>
          )}
          {!actual && hoy.estado !== 'sin_plan' && (
            <div className="vacio-acciones">
              <button className="boton" onClick={() => irARuta('#/llamada')}>
                Charlar por llamada
              </button>
              <button className="boton" onClick={() => irA('foco')}>
                Estudiar otra lección
              </button>
              {dia.saltados.length > 0 && (
                <button className="boton boton-suave" onClick={() => cambiarDia({ ...dia, saltados: [] })}>
                  Retomar lo que salté
                </button>
              )}
            </div>
          )}
        </div>
      </aside>

      {pasos.length > 0 && (
        <ol
          className="guia-pasos"
          aria-label="Lo que toca hoy"
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              mover(e.key === 'ArrowDown' ? 1 : -1)
            }
          }}
        >
          {pasos.map((p, i) => {
            const estado = p.hecho ? 'hecho' : dia.saltados.includes(p.id) ? 'saltado' : p === actual ? 'ahora' : 'luego'
            const abierto = ampliado?.id === p.id
            return (
              <li key={p.id} className={`guia-paso ${estado} ${abierto ? 'abierto' : ''}`} style={{ '--i': i } as CSSProperties}>
                <button
                  type="button"
                  className="guia-paso-cabeza"
                  aria-expanded={abierto}
                  onClick={() => pulsar(p)}
                  ref={(el) => {
                    if (el && abierto && document.activeElement?.closest('.guia-pasos')) el.focus()
                  }}
                >
                  <span className="guia-num">{p.hecho ? '✓' : i + 1}</span>
                  <span className="guia-texto">
                    <strong>{p.titulo}</strong>
                    <small>{p.detalle}</small>
                  </span>
                  <small className="guia-estado">
                    {estado === 'ahora' ? `paso ${n} de ${pasos.length}` : estado === 'saltado' ? 'hoy no' : estado === 'hecho' ? 'hecho' : ''}
                  </small>
                  <span className="guia-flecha" aria-hidden>
                    {abierto ? '→' : '›'}
                  </span>
                </button>
                <div className="guia-paso-mas" aria-hidden={!abierto}>
                  <div>
                    <div className="vacio-acciones">
                      {(!p.hecho || p.tipo === 'leccion') && estado !== 'saltado' && (
                        <button className="boton boton-principal" disabled={abriendo} tabIndex={abierto ? 0 : -1} onClick={() => void entrar(p)}>
                          {abriendo ? 'Abriendo…' : p.hecho ? 'Repasarla' : boton(p)}
                        </button>
                      )}
                      {p.tipo === 'leccion' && p.material_id && !p.hecho && estado !== 'saltado' && (
                        <button className="boton" tabIndex={abierto ? 0 : -1} onClick={() => irARuta(`#/llamada/clase/${p.clave}`)} title="Te la explica en voz y le interrumpes con tus dudas">
                          Mejor por llamada
                        </button>
                      )}
                      {estado === 'saltado' ? (
                        <button className="boton" tabIndex={abierto ? 0 : -1} onClick={() => cambiarDia({ ...dia, saltados: dia.saltados.filter((x) => x !== p.id) })}>
                          Retomar
                        </button>
                      ) : (
                        !p.hecho && (
                          <button className="boton boton-suave" tabIndex={abierto ? 0 : -1} onClick={() => saltar(p)}>
                            Hoy no
                          </button>
                        )
                      )}
                    </div>
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
