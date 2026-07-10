import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { spawn, type ChildProcess } from 'child_process'
import type { Plugin } from 'vite'

const PYTHON = 'D:\\miniconda3\\envs\\patho\\python.exe'
const LAUNCHER_SCRIPT = 'D:\\agent\\launcher.py'

function launcherPlugin(): Plugin {
  let proc: ChildProcess | null = null
  return {
    name: 'auto-launcher',
    configureServer(server) {
      proc = spawn(PYTHON, ['-u', LAUNCHER_SCRIPT], {
        stdio: 'inherit',
        cwd: 'D:\\agent',
      })
      console.log(`[auto-launcher] 已启动 launcher (pid=${proc.pid})`)
      proc.on('exit', (code) => {
        console.log(`[auto-launcher] launcher 退出 (code=${code})`)
        proc = null
      })
      server.httpServer?.on('close', () => {
        if (proc) {
          console.log('[auto-launcher] 停止 launcher')
          proc.kill()
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), launcherPlugin()],
  server: {
    proxy: {
      // 开发时代理 DuckDuckGo 搜索，绕过浏览器 CORS 限制
      '/api/search/duckduckgo': {
        target: 'https://html.duckduckgo.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/search\/duckduckgo/, '/html'),
      },
      // Patho-R1 病理分析后端服务
      '/api/patho': {
        target: 'http://localhost:8001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/patho/, ''),
      },
      // Cellpose 细胞分割后端服务
      '/api/cellpose': {
        target: 'http://localhost:8002',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/cellpose/, ''),
      },
      // 服务启动管理器
      '/api/launcher': {
        target: 'http://localhost:8099',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/launcher/, ''),
      },
    },
  },
})
