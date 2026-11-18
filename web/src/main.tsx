import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './bloques.css'
import './vistas.css'
import './examen.css'
import './chat.css'
import './movil.css'
import './viz.css'
import './video.css'
import './itunes.css'
import './proyectos.css'
import './asesor.css'
import './animo.css'
import './riso.css'
import { aplicarTema } from './componentes/tema.ts'

// El aspecto elegido, antes de pintar nada (sin destello del otro tema al abrir).
aplicarTema()
import Marco from './Marco.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Marco />
  </StrictMode>,
)
