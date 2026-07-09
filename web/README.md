# Cookie Agent

一个最小化的 React Agent 示例，包含感知、记忆、推理、工具、输出五个部分。

## 联网搜索

Agent 内置 `web_search` 工具，支持以下搜索供应商：

| 供应商 | 说明 | 官网 |
| --- | --- | --- |
| `duckduckgo` | **免费**，无需 API Key | https://duckduckgo.com |
| `tavily` | 专为 AI Agent 设计 | https://tavily.com |
| `serper` | Google 搜索结果 | https://serper.dev |
| `mock` | 本地演示模式，不调用真实 API | - |

复制 `.env.example` 为 `.env`，按需填写：

```env
# 免费方案
VITE_SEARCH_PROVIDER=duckduckgo
VITE_SEARCH_MAX_RESULTS=5

# 或付费方案
VITE_SEARCH_PROVIDER=tavily
VITE_SEARCH_API_KEY=your-tavily-api-key
VITE_SEARCH_MAX_RESULTS=5
```

**DuckDuckGo 注意事项**：
- 开发环境（`npm run dev`）已配置 Vite 代理，可直接使用。
- 生产部署时浏览器有 CORS 限制，需要配置 `VITE_CORS_PROXY`（例如 `https://corsproxy.io/?`），或自行搭建后端代理。
- 未配置搜索供应商时，开发环境默认使用 `duckduckgo`，生产环境回退到 `mock`。

---

# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.
