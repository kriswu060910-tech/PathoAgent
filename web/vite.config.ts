import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { spawn, type ChildProcess } from 'child_process'
import { resolve } from 'path'
import type { Plugin } from 'vite'

const PROJECT_ROOT = resolve(__dirname, '..')
const PYTHON = process.env.PYTHON_PATH || 'python'

function launcherPlugin(): Plugin {
  let proc: ChildProcess | null = null

  function spawnLauncher() {
    if (proc && proc.exitCode === null) {
      return { ok: true, message: `Launcher 已在运行 (pid=${proc.pid})` }
    }
    proc = spawn(PYTHON, ['-u', '-m', 'launcher.main', '--auto-start'], {
      stdio: 'inherit',
      cwd: PROJECT_ROOT,
    })
    console.log(`[auto-launcher] 已启动 launcher (pid=${proc.pid})`)
    proc.on('exit', (code) => {
      console.log(`[auto-launcher] launcher 退出 (code=${code})`)
      proc = null
    })
    return { ok: true, message: `Launcher 已启动 (pid=${proc.pid})` }
  }

  return {
    name: 'auto-launcher',
    configureServer(server) {
      // 前端可通过 POST /api/launch 手动启动 Launcher
      server.middlewares.use((req, res, next) => {
        if (req.url === '/api/launch' && req.method === 'POST') {
          const result = spawnLauncher()
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(result))
          return
        }
        next()
      })

      // 开发时自动启动
      spawnLauncher()

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
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, resolve(__dirname), '')
  const visionTarget = env.VITE_VISION_PROXY_TARGET || 'https://dashscope.aliyuncs.com/compatible-mode/v1'

  return {
    plugins: [react(), launcherPlugin()],
    server: {
      proxy: {
        // 开发时代理 DuckDuckGo 搜索，绕过浏览器 CORS 限制
        '/api/search/duckduckgo': {
          target: 'https://html.duckduckgo.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/search\/duckduckgo/, '/html'),
        },
        // 视觉 API 代理（通过 .env 中 VITE_VISION_PROXY_TARGET 配置目标地址）
        '/api/vision': {
          target: visionTarget,
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/api\/vision/, ''),
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
        // 用户认证服务
        '/api/auth': {
          target: 'http://localhost:8100',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/auth/, ''),
        },
      },
    },
  }
})
