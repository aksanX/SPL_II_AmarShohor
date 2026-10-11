/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // `@/x` means `src/x`, so imports don't need long `../../` chains. Keep in sync with `paths` in tsconfig.app.json.
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // Typing tests are slow when all files run in parallel on a busy machine; 5 s timed out now and then.
  test: { testTimeout: 15_000 },
})
