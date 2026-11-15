import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'

// El token lo pone el proxy, no la página: se lee de servidor/.env (MAGISTER_TOKEN).
function tokenDelServidor(): string {
  try {
    const env = readFileSync(new URL('../servidor/.env', import.meta.url), 'utf-8')
    return env.match(/^MAGISTER_TOKEN=(.*)$/m)?.[1]?.trim() ?? ''
  } catch {
    return ''
  }
}

const destino = process.env.MAGISTER_API ?? 'http://127.0.0.1:8000'
const token = tokenDelServidor()

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: destino, headers: token ? { 'X-Magister-Token': token } : {} },
    },
  },
})
