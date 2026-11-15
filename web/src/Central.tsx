import Mascota from './Mascota.tsx'
import type { IdModo } from './modos.ts'

// Recibe el modo como dato; no sabe nada de la barra lateral.
export default function Central({ modo }: { modo: IdModo }) {
  switch (modo) {
    case 'libre':
      return <EstudioLibre />
    case 'tutor':
      return <Pendiente texto="El tutor prepara la sesión desde tus fuentes y te lleva." />
    case 'roadmap':
      return <Pendiente texto="Tus temas con lecciones partidas en ideas clave, dependencias y avance." />
    case 'calendario':
      return <Pendiente texto="Tus lecciones y repasos repartidos por días." />
    case 'temas':
      return <Pendiente texto="Tus documentos y de dónde sale cada cita." />
    case 'proyectos':
      return <Pendiente texto="El camino que sale de lo que construyes y su diario de decisiones." />
    case 'fichas':
      return <Pendiente texto="Fichas de repaso desde una lección." />
    case 'video':
      return <Pendiente texto="El guion por escenas y el vídeo montado con voz y subtítulos." />
    case 'repaso':
      return <Pendiente texto="Qué toca repasar, cuando tú quieras." />
    case 'progreso':
      return <Pendiente texto="El porcentaje del camino, el dominio por concepto, los días estudiados y el tiempo." />
    case 'construccion':
      return <Pendiente texto="El método de este libro aplicado a otro tema." />
    case 'hablar':
      return <Pendiente texto="Entrada por voz con la frase central." />
  }
}

function EstudioLibre() {
  return (
    <div className="libre">
      <Mascota />
      <h1>¿Qué tema tratamos hoy?</h1>
      <form className="entrada" onSubmit={(e) => e.preventDefault()}>
        <input type="text" placeholder="Escribe un tema o una pregunta" aria-label="Tu mensaje" />
        <button type="button" className="micro" disabled title="Micrófono sin conectar">
          Micrófono · sin conectar
        </button>
      </form>
    </div>
  )
}

function Pendiente({ texto }: { texto: string }) {
  return <p className="vacio">Próximamente: {texto}</p>
}
