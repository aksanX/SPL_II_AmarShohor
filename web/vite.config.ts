/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Typing tests are slow when all files run in parallel on a busy machine; 5 s timed out now and then.
  test: { testTimeout: 15_000 },
})
