import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [vue()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined

          if (id.includes('/@xterm/') || id.includes('/xterm/')) return 'vendor-xterm'
          if (id.includes('/lucide-vue-next/')) return 'vendor-ui'
          return 'vendor'
        },
      },
    },
  },
})
