import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // 预先打包编辑器依赖，避免开发中途二次优化产生两份 ProseMirror 实例
  optimizeDeps: {
    include: ['@tiptap/react', '@tiptap/core', '@tiptap/starter-kit', '@tiptap/pm/state', '@tiptap/pm/view', '@tiptap/pm/transform', '@tiptap/pm/model'],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
  },
})
