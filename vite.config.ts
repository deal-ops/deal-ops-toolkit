/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// `vite preview` serves the build with the same security headers as Vercel (vercel.json),
// so the end-to-end tests run under the production CSP (Tech Design §4).
const vercel = JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url), 'utf8')) as {
  headers: { headers: { key: string; value: string }[] }[]
}
const headers = Object.fromEntries(vercel.headers[0].headers.map((h) => [h.key, h.value]))

export default defineConfig({
  plugins: [react()],
  preview: { headers },
  test: { include: ['src/**/*.test.{ts,tsx}'] },
})
