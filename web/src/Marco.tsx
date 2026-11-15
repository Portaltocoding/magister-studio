import { useCallback, useEffect, useState } from 'react'
import { listarConversaciones, type Conversacion } from './api.ts'
import BarraLateral from './BarraLateral.tsx'
import BarraSesion from './BarraSesion.tsx'
import Central from './Central.tsx'
import type { IdModo } from './modos.ts'

// Tres zonas: la barra lateral y la barra de sesión no cambian;
// la zona central recibe el modo activo y pinta lo suyo.
export default function Marco() {
  const [modo, setModo] = useState<IdModo>('libre')
  const [conversaciones, setConversaciones] = useState<Conversacion[]>([])
  const [activa, setActiva] = useState<number | null>(null)
  const [tipoNueva, setTipoNueva] = useState<'libre' | 'plan'>('libre')

  const recargar = useCallback(() => {
    listarConversaciones()
      .then(setConversaciones)
      .catch(() => setConversaciones([]))
  }, [])

  useEffect(recargar, [recargar])

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
