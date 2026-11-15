import { useState } from 'react'
import BarraLateral from './BarraLateral.tsx'
import BarraSesion from './BarraSesion.tsx'
import Central from './Central.tsx'
import type { IdModo } from './modos.ts'

// Tres zonas: la barra lateral y la barra de sesión no cambian;
// la zona central recibe el modo activo y pinta lo suyo.
export default function Marco() {
  const [modo, setModo] = useState<IdModo>('libre')

  return (
    <div className="marco">
      <BarraLateral modoActivo={modo} alElegir={setModo} />
      <BarraSesion />
      <main className="central">
        <Central modo={modo} />
      </main>
    </div>
  )
}
