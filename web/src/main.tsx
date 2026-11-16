import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './bloques.css'
import './vistas.css'
import Marco from './Marco.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Marco />
  </StrictMode>,
)
