/**
 * OpenAI-compatible provider (OpenAI or any gateway exposing the same API).
 * Used when OPENAI_API_KEY is set and ANTHROPIC_API_KEY is not.
 *
 *   OPENAI_API_KEY   required
 *   OPENAI_BASE_URL  optional, for gateways (defaults to OpenAI)
 *   OPENAI_MODEL     optional, defaults to DEFAULT_OPENAI_MODEL
 *
 * The response is constrained to RESPONSE_SCHEMA with response_format json_schema.
 */

import OpenAI from 'openai'
import { RESPONSE_SCHEMA, SYSTEM_PROMPT, buildUserMessage } from '../ruleParsing.js'

export const DEFAULT_OPENAI_MODEL = 'claude-opus-5.5'

export function openAiModel() {
  return process.env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL
}

export async function callOpenAiCompatible(input, { client } = {}) {
  const api =
    client ??
    new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL || undefined,
      timeout: 30_000,
      maxRetries: 1,
    })

  const response = await api.chat.completions.create({
    model: openAiModel(),
    max_completion_tokens: 4096,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserMessage(input) },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'discount_rule', strict: true, schema: RESPONSE_SCHEMA },
    },
  })

  const choice = response.choices?.[0]
  if (!choice) return { kind: 'json', text: '' }
  if (choice.message?.refusal) return { kind: 'refusal' }
  if (choice.finish_reason === 'length') return { kind: 'truncated' }
  return { kind: 'json', text: choice.message?.content ?? '' }
}
