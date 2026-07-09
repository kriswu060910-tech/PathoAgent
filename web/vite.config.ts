import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // 开发时代理 DuckDuckGo 搜索，绕过浏览器 CORS 限制
      '/api/search/duckduckgo': {
        target: 'https://html.duckduckgo.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/search\/duckduckgo/, '/html'),
      },
    },
  },
})
