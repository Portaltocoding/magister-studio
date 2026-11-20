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
import './bienvenida.css'
import { aplicarTema } from './componentes/tema.ts'
import { aplicarTamano } from './componentes/escala.ts'

// El aspecto elegido, antes de pintar nada (sin destello del otro tema al abrir).
aplicarTema()
// El tamaño de la interfaz (zoom), también antes de pintar.
aplicarTamano()

// Si se reconstruye la web con la pestaña abierta, los trozos de las pantallas cambian de nombre y abrir una
// pantalla nueva fallaría: se recarga la página (una vez por minuto como mucho, para no entrar en bucle).
window.addEventListener('vite:preloadError', (e) => {
  try {
    const antes = Number(sessionStorage.getItem('magister-recarga') ?? 0)
    if (Date.now() - antes < 60_000) return
    sessionStorage.setItem('magister-recarga', String(Date.now()))
  } catch {
    /* sin almacenamiento: se recarga igual */
  }
  e.preventDefault()
  window.location.reload()
})
import Marco from './Marco.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Marco />
  </StrictMode>,
)
