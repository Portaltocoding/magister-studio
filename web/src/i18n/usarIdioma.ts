import { useEffect, useState } from 'react'
import { EVENTO_IDIOMA, idiomaActual, t, type Idioma } from './i18n.ts'

// El idioma de ahora, y un nuevo render del componente cuando cambia (la bienvenida, la barra y Ajustes siguen
// montadas al cambiarlo; el resto de pantallas se montan ya con el idioma nuevo). Devuelve también `t`.
export function usarIdioma(): { idioma: Idioma; t: typeof t } {
  const [idioma, setIdioma] = useState<Idioma>(idiomaActual)
  useEffect(() => {
    const al = () => setIdioma(idiomaActual())
    window.addEventListener(EVENTO_IDIOMA, al)
    al()
    return () => window.removeEventListener(EVENTO_IDIOMA, al)
  }, [])
  return { idioma, t }
}
