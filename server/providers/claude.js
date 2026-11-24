/**
 * Anthropic API provider. Used when ANTHROPIC_API_KEY is set.
 * The response is constrained to RESPONSE_SCHEMA with structured outputs.
 */

import Anthropic from '@anthropic-ai/sdk'
import { RESPONSE_SCHEMA, SYSTEM_PROMPT, buildUserMessage } from '../ruleParsing.js'

export const CLAUDE_MODEL = 'claude-opus-5-5'

export async function callClaude(input, { client = new Anthropic() } = {}) {
  const response = await client.beta.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4096,
    // If a safety classifier declines, the API retries on a fallback model
    // within the same call instead of failing the request.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: {
      effort: 'low',
      format: { type: 'json_schema', schema: RESPONSE_SCHEMA },
    },
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserMessage(input) }],
  })

  if (response.stop_reason === 'refusal') return { kind: 'refusal' }
  if (response.stop_reason === 'max_tokens') return { kind: 'truncated' }
  const textBlock = response.content.find((b) => b.type === 'text')
  return { kind: 'json', text: textBlock?.text ?? '' }
}
