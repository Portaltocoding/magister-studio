import { Component, type ReactNode } from 'react'

// Si una pantalla falla al pintarse, sin esto React desmonta la app entera y queda en blanco.
// Así solo cae esa pantalla: se dice qué ha pasado y se puede volver a intentar o ir a otra.
export default class FalloPantalla extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('Una pantalla ha fallado al pintarse:', error)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="cargando-fallo" role="alert">
        <p>Esta pantalla ha fallado: {this.state.error.message}. Las demás siguen funcionando.</p>
        <button type="button" className="boton" onClick={() => this.setState({ error: null })}>
          Reintentar
        </button>
      </div>
    )
  }
}
