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

  const recargar = useCallback(() => {
    listarConversaciones()
      .then(setConversaciones)
      .catch(() => setConversaciones([]))
  }, [])

  useEffect(recargar, [recargar])

  return (
    <div className="marco">
      <BarraLateral
        modoActivo={modo}
        alElegir={setModo}
        conversaciones={conversaciones}
        activa={activa}
        alElegirConversacion={(id) => {
          setActiva(id)
          setModo('libre')
        }}
        alCambiar={recargar}
      />
      <BarraSesion />
      <main className="central">
        <Central
          modo={modo}
          conversacionId={activa}
          alCrearConversacion={(id) => {
            setActiva(id)
            recargar()
          }}
          alCambiarConversaciones={recargar}
          irA={setModo}
        />
      </main>
    </div>
  )
}
