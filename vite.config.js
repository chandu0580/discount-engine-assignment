import fs from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Reads KEY=value pairs from the project's .env files only (later files win).
 * Vite's loadEnv also merges the shell environment, which is what we need to
 * avoid here.
 */
function readEnvFiles(mode) {
  const values = {}
  for (const file of ['.env', '.env.local', `.env.${mode}`, `.env.${mode}.local`]) {
    if (!fs.existsSync(file)) continue
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
      if (match) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2')
    }
  }
  return values
}

/**
 * Serves the Vercel functions in api/ from the Vite dev server, so local
 * development needs only `npm run dev`. Production uses Vercel's own runtime.
 */
function localApiRoutes() {
  return {
    name: 'local-api-routes',
    configureServer(server) {
      server.middlewares.use('/api/parse-rule', async (req, res) => {
        let raw = ''
        for await (const chunk of req) raw += chunk
        req.body = raw
        try {
          const { default: handler } = await server.ssrLoadModule('/api/parse-rule.js')
          await handler(req, res)
        } catch (err) {
          server.config.logger.error(String(err?.stack ?? err))
          res.statusCode = 500
          res.end(JSON.stringify({ status: 'error', message: 'Local API error, see terminal.' }))
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  // Make server-only secrets from .env.local visible to the local API routes.
  // They are not VITE_-prefixed, so they are never bundled into the browser code.
  // When .env.local sets a provider, it replaces any provider variables already
  // in the shell (often set globally for other tools), so settings don't mix.
  const fileEnv = readEnvFiles(mode)
  const keys = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_MODEL']
  if (keys.some((key) => fileEnv[key] && fileEnv[key] !== process.env[key])) {
    for (const key of keys) {
      if (fileEnv[key]) process.env[key] = fileEnv[key]
      else delete process.env[key]
    }
  }

  return {
    plugins: [react(), localApiRoutes()],
    // pdf.js (~500 kB) is its own chunk, loaded only when a PDF is uploaded
    build: { chunkSizeWarningLimit: 600 },
  }
})
