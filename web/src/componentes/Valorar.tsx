import { useEffect, useState } from 'react'
import { enviarJson, pedir } from '../api.ts'
import { t } from '../i18n/i18n.ts'
import { usarIdioma } from '../i18n/usarIdioma.ts'

// Por qué no sirve: cada motivo afina lo que Magister aprende de ti. La lista la da el servidor (tono/confianza.py,
// MOTIVOS), una vez por página: Valorar sale junto a cada respuesta.
type Motivo = { id: string; nombre: string }
let motivosPedidos: Promise<Motivo[]> | null = null
const pedirMotivos = () =>
  (motivosPedidos ??= pedir<{ motivos: Motivo[] }>('/api/afinado')
    .then((a) => a.motivos)
    .catch(() => {
      motivosPedidos = null // se reintenta la próxima vez
      return []
    }))

interface Props {
  traza: string
  inicial: boolean | null
  alPedirOtra?: (texto: string) => void
}

// Me sirve o no me sirve, junto a cada respuesta. «No me sirve» pide qué falla y puede pedir otra explicación.
export default function Valorar({ traza, inicial, alPedirOtra }: Props) {
  usarIdioma()
  const [voto, setVoto] = useState<boolean | null>(inicial)
  const [abierto, setAbierto] = useState(false)
  const [comentario, setComentario] = useState('')
  const [motivos, setMotivos] = useState<string[]>([])
  const [hecho, setHecho] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [fallo, setFallo] = useState(false)
  const [lista, setLista] = useState<Motivo[]>([])
  useEffect(() => {
    if (abierto) pedirMotivos().then(setLista)
  }, [abierto])

  // Un voto cada vez: mientras se envía, los botones esperan; si falla, se dice y se puede repetir.
  const votar = async (bien: boolean, otra = false) => {
    if (enviando) return
    setEnviando(true)
    setFallo(false)
    try {
      await pedir(`/api/trazas/${traza}/feedback`, enviarJson({ bien, comentario: comentario.trim() || null, otra, motivos: bien ? [] : motivos }))
    } catch {
      setFallo(true)
      return
    } finally {
      setEnviando(false)
    }
    setVoto(bien)
    setAbierto(false)
    setHecho(true)
    if (otra && alPedirOtra)
      alPedirOtra(t('valorar.otra', { motivo: comentario.trim() ? `: ${comentario.trim()}` : '' }))
  }

  return (
    <div className="valorar">
      <button className={`voto voto-bien ${voto === true ? 'votado' : ''}`} aria-pressed={voto === true} disabled={enviando || voto === true} onClick={() => votar(true)}>
        {t('valorar.meSirve')}
      </button>
      <button
        className={`voto voto-mal ${voto === false ? 'votado' : ''}`}
        aria-pressed={voto === false}
        onClick={() => setAbierto(!abierto)}
      >
        {t('valorar.noMeSirve')}
      </button>
      {hecho && !abierto && !fallo && (
        <span className="nota" role="status">
          {t('valorar.anotado')}
        </span>
      )}
      {fallo && (
        <span className="nota" role="alert">
          {t('valorar.fallo')}
        </span>
      )}
      {abierto && (
        <div className="valorar-caja">
          <div className="valorar-motivos" role="group" aria-label={t('valorar.queFallo')}>
            {lista.map(({ id, nombre }) => (
              <button
                key={id}
                type="button"
                className={`opcion-chip ${motivos.includes(id) ? 'elegida' : ''}`}
                aria-pressed={motivos.includes(id)}
                onClick={() => setMotivos(motivos.includes(id) ? motivos.filter((m) => m !== id) : [...motivos, id])}
              >
                {nombre}
              </button>
            ))}
          </div>
          <textarea
            autoFocus
            placeholder={t('valorar.algoMas')}
            aria-label={t('valorar.queFallo')}
            value={comentario}
            onChange={(e) => setComentario(e.target.value)}
          />
          <div className="botones">
            <button className="boton" onClick={() => votar(false)}>
              {t('valorar.enviar')}
            </button>
            {alPedirOtra && (
              <button className="boton boton-principal" onClick={() => votar(false, true)}>
                {t('valorar.enviarOtra')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
