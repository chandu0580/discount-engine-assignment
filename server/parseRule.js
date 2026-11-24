/**
 * parseRule.js
 *
 * Picks the configured LLM provider, runs it, and turns the answer into a
 * validated rule. Server-only: API keys never reach the browser.
 *
 * The model's answer is not trusted. After schema validation
 * (ruleParsing.js), checkAgainstText confirms that every number and name in
 * the rule actually appears in the user's text. A failed check is retried
 * once, telling the model what was wrong.
 *
 * Provider choice, first match wins:
 *   ANTHROPIC_API_KEY  → Anthropic API (Claude)
 *   OPENAI_API_KEY     → OpenAI-compatible API (OPENAI_BASE_URL / OPENAI_MODEL)
 */

import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { interpretModelOutput } from './ruleParsing.js'
import { callClaude, CLAUDE_MODEL } from './providers/claude.js'
import { callOpenAiCompatible, openAiModel } from './providers/openaiCompatible.js'

export function selectProvider(env = process.env) {
  if (env.ANTHROPIC_API_KEY) return { name: 'anthropic', model: CLAUDE_MODEL, call: callClaude }
  if (env.OPENAI_API_KEY) return { name: 'openai-compatible', model: openAiModel(), call: callOpenAiCompatible }
  return null
}

// ── Grounding: does the rule match what the user wrote? ──

/** "Nordic Basics" and "nordic basic products" share the stems "nordic basic". */
const stems = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .map((w) => w.replace(/s$/, ''))
    .join(' ')

const mentions = (text, name) => Boolean(stems(name)) && ` ${stems(text)} `.includes(` ${stems(name)} `)

/** Numbers as written in the text: "Rs.5,000" → 5000, "20%" → 20. */
export function numbersIn(text) {
  return (String(text).replace(/(\d),(?=\d)/g, '$1').match(/\d+(?:\.\d+)?/g) ?? []).map(Number)
}

const invalid = (detail) => ({
  status: 'invalid',
  message: `The parsed rule doesn't match your text: ${detail}. Try rephrasing it.`,
})

/**
 * Checks a parsed rule against the user's text and the known names.
 * Returns the (possibly corrected) result, or an 'invalid' result explaining
 * the mismatch so the model can be asked again.
 */
export function checkAgainstText(result, { text, knownBrands = [], knownPlatforms = [] }) {
  if (result.status !== 'ok') return result
  const rule = { ...result.rule }
  const numbers = numbersIn(text)

  if (!numbers.includes(rule.value)) {
    return invalid(`the discount amount ${rule.value} does not appear in the text`)
  }

  if (rule.scope === 'cart') {
    if (rule.minCartValue > 0 && !numbers.includes(rule.minCartValue)) {
      return invalid(`the minimum cart value ${rule.minCartValue} does not appear in the text`)
    }
    const unused = numbers.filter((n) => n !== rule.value)
    if (rule.minCartValue === 0 && unused.length > 0) {
      return invalid(`the text mentions ${unused[0]}, but the rule has no minimum cart value`)
    }
    return { ...result, rule }
  }

  // Brand or platform: settle the name in code, using the known spellings
  const named = [
    ...knownBrands.filter((n) => mentions(text, n)).map((name) => ({ scope: 'brand', name })),
    ...knownPlatforms.filter((n) => mentions(text, n)).map((name) => ({ scope: 'platform', name })),
  ]
  const sameScope = rule.scope === 'brand' ? knownBrands : knownPlatforms
  const known = sameScope.find((n) => stems(n) === stems(rule.appliesTo))

  if (known && mentions(text, known)) {
    rule.appliesTo = known
  } else if (named.length === 1) {
    // The model picked a name the user didn't write, but exactly one known
    // brand/platform is in the text: that is the target.
    rule.scope = named[0].scope
    rule.appliesTo = named[0].name
  } else if (!mentions(text, rule.appliesTo)) {
    return invalid(`"${rule.appliesTo}" is not mentioned in the text`)
  }
  return { ...result, rule }
}

// ── Running the parser ──

async function attempt(input, provider) {
  return checkAgainstText(interpretModelOutput(await provider.call(input)), input)
}

/** A discount amount written as a percentage or a rupee figure: "10%", "Rs.100", "₹50". */
const AMOUNT_IN_TEXT = /\d+(?:\.\d+)?\s*%|(?:rs\.?|₹|inr)\s*\d/i

export async function parseRule(input, provider = selectProvider()) {
  if (!provider) throw new Error('No LLM provider configured')
  const first = await attempt(input, provider)

  // Ask once more only when the first answer contradicts the text:
  //  - 'invalid': the model answered, but the rule doesn't hold up;
  //  - 'unresolvable' although the text states an amount.
  // Genuinely vague input ("a discount for big orders") is not retried:
  // asking again can't add information the user didn't give.
  let previousError = null
  if (first.status === 'invalid') {
    previousError = first.message
  } else if (first.status === 'unresolvable' && AMOUNT_IN_TEXT.test(input.text)) {
    previousError = `you said the rule is incomplete ("${first.message}"), but the text states an amount. Extract the rule if the text gives its amount and target`
  }
  return previousError ? attempt({ ...input, previousError }, provider) : first
}

/**
 * Maps SDK errors from either provider to an HTTP status and a message the
 * user can act on.
 */
export function describeProviderError(err) {
  const isAuth = err instanceof Anthropic.AuthenticationError || err instanceof OpenAI.AuthenticationError ||
    err instanceof Anthropic.PermissionDeniedError || err instanceof OpenAI.PermissionDeniedError
  if (isAuth) return { status: 503, message: 'The rule parser is misconfigured (the API key was rejected).' }

  if (err instanceof Anthropic.RateLimitError || err instanceof OpenAI.RateLimitError) {
    return { status: 429, message: 'Too many requests right now. Wait a few seconds and try again.' }
  }

  const unavailable =
    err instanceof Anthropic.APIConnectionError || err instanceof OpenAI.APIConnectionError ||
    ((err instanceof Anthropic.APIError || err instanceof OpenAI.APIError) && err.status >= 500)
  if (unavailable) return { status: 502, message: 'The AI service is unavailable right now. Try again in a moment.' }

  return { status: 500, message: 'Something went wrong while parsing the rule.' }
}
