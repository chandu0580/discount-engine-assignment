/**
 * POST /api/parse-rule
 * Body: { text: string, knownBrands?: string[], knownPlatforms?: string[] }
 *
 * Vercel serverless function. In local development, vite.config.js mounts
 * this same handler on the dev server, so `npm run dev` needs no extra step.
 * Uses only Node's req/res API so it runs unchanged in both places.
 */

import { parseRule, selectProvider, describeProviderError } from '../server/parseRule.js'
import { MAX_RULE_TEXT_LENGTH } from '../server/ruleParsing.js'

function send(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

function cleanNames(value) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((v) => typeof v === 'string').map((v) => v.trim()))]
    .filter((v) => v && v.length <= 80)
    .slice(0, 50)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return send(res, 405, { status: 'error', message: 'Use POST.' })
  }

  let body = req.body
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body)
    } catch {
      body = null
    }
  }

  const text = typeof body?.text === 'string' ? body.text.trim() : ''
  if (!text) {
    return send(res, 400, { status: 'error', message: 'Describe a discount rule first.' })
  }
  if (text.length > MAX_RULE_TEXT_LENGTH) {
    return send(res, 400, {
      status: 'error',
      message: `Keep the rule under ${MAX_RULE_TEXT_LENGTH} characters and describe one rule at a time.`,
    })
  }

  const provider = selectProvider()
  if (!provider) {
    return send(res, 503, {
      status: 'error',
      message: 'The rule parser is not configured on this server (set ANTHROPIC_API_KEY or OPENAI_API_KEY).',
    })
  }

  try {
    const result = await parseRule(
      { text, knownBrands: cleanNames(body.knownBrands), knownPlatforms: cleanNames(body.knownPlatforms) },
      provider
    )
    return send(res, 200, result)
  } catch (err) {
    const { status, message } = describeProviderError(err)
    console.error(`parse-rule failed (${provider.name}/${provider.model}):`, err?.status ?? '', err?.message ?? err)
    return send(res, status, { status: 'error', message })
  }
}
