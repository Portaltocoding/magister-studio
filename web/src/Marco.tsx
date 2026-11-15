import { useCallback, useEffect, useState } from 'react'
import { listarConversaciones, type Conversacion } from './api.ts'
import BarraLateral from './BarraLateral.tsx'
import BarraSesion from './BarraSesion.tsx'
import Central from './Central.tsx'
import { MODOS, type IdModo } from './modos.ts'

// El modo y la conversación viajan en la URL (#/roadmap, #/conversacion/6):
// recargar no te saca de donde estabas y se puede enlazar una vista.
function leerRuta(): { modo: IdModo; conversacion: number | null } {
  const partes = window.location.hash.replace(/^#\/?/, '').split('/')
  if (partes[0] === 'conversacion' && Number(partes[1])) return { modo: 'libre', conversacion: Number(partes[1]) }
  const modo = MODOS.find((m) => m.id === partes[0] && m.encendido)?.id
  return { modo: modo ?? 'libre', conversacion: null }
}

function escribirRuta(modo: IdModo, conversacion: number | null) {
  const ruta = modo === 'libre' && conversacion != null ? `#/conversacion/${conversacion}` : `#/${modo}`
  // #/fichas/3/L2 lleva a una lección: el panel lo lee y luego limpia la ruta.
  if (window.location.hash !== ruta && !window.location.hash.startsWith(`${ruta}/`))
    window.history.replaceState(null, '', ruta)
}

// Tres zonas: la barra lateral y la barra de sesión no cambian;
// la zona central recibe el modo activo y pinta lo suyo.
export default function Marco() {
  const inicial = leerRuta()
  const [modo, setModo] = useState<IdModo>(inicial.modo)
  const [conversaciones, setConversaciones] = useState<Conversacion[]>([])
  const [activa, setActiva] = useState<number | null>(inicial.conversacion)
  const [tipoNueva, setTipoNueva] = useState<'libre' | 'plan'>(() =>
    window.location.hash.startsWith('#/nuevo-plan') ? 'plan' : 'libre',
  )

  const recargar = useCallback(() => {
    listarConversaciones()
      .then(setConversaciones)
      .catch(() => setConversaciones([]))
  }, [])

  useEffect(recargar, [recargar])
  useEffect(() => escribirRuta(modo, activa), [modo, activa])
  useEffect(() => {
    const alCambiar = () => {
      const r = leerRuta()
      setModo(r.modo)
      setActiva(r.conversacion)
    }
    window.addEventListener('hashchange', alCambiar)
    return () => window.removeEventListener('hashchange', alCambiar)
  }, [])

  const actual = conversaciones.find((c) => c.id === activa)
  const tipo: 'libre' | 'plan' = actual ? (actual.tipo === 'plan' ? 'plan' : 'libre') : tipoNueva

  return (
    <div className="marco">
      <BarraLateral
        modoActivo={modo}
        alElegir={(m) => {
          if (m === 'libre') {
            setActiva(null)
            setTipoNueva('libre')
          }
          setModo(m)
        }}
        conversaciones={conversaciones}
        activa={activa}
        alElegirConversacion={(id) => {
          setActiva(id)
          if (id == null) setTipoNueva('libre')
          setModo('libre')
        }}
        alCambiar={recargar}
      />
      <BarraSesion />
      <main className="central">
        <Central
          modo={modo}
          conversacionId={activa}
          tipoConversacion={tipo}
          alCrearConversacion={(id) => {
            setActiva(id)
            recargar()
          }}
          alCambiarConversaciones={recargar}
          irA={setModo}
          alNuevoPlan={() => {
            setActiva(null)
            setTipoNueva('plan')
            setModo('libre')
          }}
        />
      </main>
    </div>
  )
}
