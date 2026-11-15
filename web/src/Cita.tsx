import { useEffect, useState } from 'react'
import { verFragmento, type CitaInfo, type FragmentoInfo } from './api.ts'

// Las marcas [123] del tutor pasan a enlaces internos que el hilo pinta como botones.
// Se recomponen aunque lleguen partidas entre dos deltas, porque se aplican al texto entero.
export const conMarcas = (texto: string) => texto.replace(/\[(\d{1,9})\]/g, '[\\[$1\\]](#cita-$1)')

interface Props {
  id: number
  info?: CitaInfo
  alCerrar: () => void
}

// Panel lateral con el fragmento citado, su procedencia y la cita resaltada.
export function PanelCita({ id, info, alCerrar }: Props) {
  const [f, setF] = useState<FragmentoInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setF(null)
    verFragmento(id)
      .then(setF)
      .catch((e) => setError(String(e.message)))
  }, [id])

  const resaltar = (texto: string) => {
    const literal = info?.cita_literal
    if (!literal) return texto
    const i = texto.indexOf(literal)
    if (i < 0) return texto
    return (
      <>
        {texto.slice(0, i)}
        <mark>{literal}</mark>
        {texto.slice(i + literal.length)}
      </>
    )
  }

  return (
    <aside className="panel-cita" role="dialog" aria-label={`Fuente del fragmento ${id}`}>
      <div className="cabecera-seccion">
        <h2>Fuente [{id}]</h2>
        <button className="boton-mini" onClick={alCerrar} aria-label="Cerrar">
          ×
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {!f && !error && <p className="vacio">Cargando…</p>}
      {f && (
        <>
          <p>
            <strong>{f.documento.titulo}</strong>
            <br />
            <span className="nota-linea">
              {f.fuente.nombre} · {f.fuente.tipo} · confianza {f.fuente.confianza}
              {f.version.ingerida_en ? ` · ${new Date(f.version.ingerida_en).toLocaleDateString('es-ES')}` : ''}
            </span>
          </p>
          {f.documento.uri.startsWith('http') && (
            <p>
              <a href={f.documento.uri} target="_blank" rel="noreferrer">
                Abrir el original
              </a>
            </p>
          )}
          {info?.dudosa && (
            <p className="aviso-dudosa">
              Cita dudosa: el código no encuentra en este fragmento una frase que sostenga lo que dice el tutor.
            </p>
          )}
          {f.version.estado === 'retirada' && <p className="aviso-dudosa">Esta versión del documento está retirada.</p>}
          <div className="texto-fragmento">
            <span className="contexto">…{f.antes}</span>
            <span className="fragmento-citado">{resaltar(f.texto)}</span>
            <span className="contexto">{f.despues}…</span>
          </div>
        </>
      )}
    </aside>
  )
}
