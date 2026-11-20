// La primera vez que entras en una pantalla, la mascota te dice para qué sirve en una frase y se ofrece a contestarte.
// Sale una vez por pantalla (se recuerda en este navegador) y se pueden apagar todas.
import { useState } from 'react'
import Mascota from '../Mascota.tsx'
import { usarIdioma } from '../i18n/usarIdioma.ts'
import type { Clave } from '../i18n/i18n.ts'
import { abrirAsesor } from './Asesor.tsx'

export const PISTAS = ['hoy', 'libre', 'roadmap', 'calendario', 'temas', 'fichas', 'foco', 'video', 'repaso', 'examen', 'progreso', 'proyectos', 'notas']

const VISTAS = 'magister-pistas-vistas'
const APAGADAS = 'magister-pistas-apagadas'

function leerVistas(): string[] {
  try {
    if (localStorage.getItem(APAGADAS) === '1') return PISTAS
    return JSON.parse(localStorage.getItem(VISTAS) ?? '[]') as string[]
  } catch {
    return PISTAS // sin almacenamiento, mejor no insistir en cada visita
  }
}

function guardar(clave: string, valor: string) {
  try {
    localStorage.setItem(clave, valor)
  } catch {
    /* sin almacenamiento: vale para esta visita */
  }
}

export default function PistaPantalla({ modo }: { modo: string }) {
  const { t } = usarIdioma()
  const [vistas, setVistas] = useState(leerVistas)
  const texto = PISTAS.includes(modo) ? t(`pista.${modo}` as Clave) : ''
  if (!texto || vistas.includes(modo)) return null
  const cerrar = () => {
    const nuevas = [...vistas, modo]
    setVistas(nuevas)
    guardar(VISTAS, JSON.stringify(nuevas))
  }
  return (
    <aside className="pista-pantalla" role="note" aria-label={t('pista.aria')}>
      <span className="pista-mascota" aria-hidden>
        <Mascota mini quieta />
      </span>
      <p>{texto}</p>
      <div className="pista-botones">
        <button type="button" className="boton-mini" onClick={() => (cerrar(), abrirAsesor())}>
          {t('pista.preguntame')}
        </button>
        <button type="button" className="boton-mini" onClick={cerrar}>
          {t('pista.entendido')}
        </button>
        <button
          type="button"
          className="pista-apagar"
          onClick={() => {
            guardar(APAGADAS, '1')
            setVistas(PISTAS)
          }}
        >
          {t('pista.nomas')}
        </button>
      </div>
    </aside>
  )
}
