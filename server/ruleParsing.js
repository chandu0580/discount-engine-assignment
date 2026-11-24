/**
 * ruleParsing.js
 *
 * Provider-independent part of the plain-English rule parser: the prompt,
 * the JSON schema the model must answer in, and the mapping from the model's
 * answer to a validated rule. Providers in ./providers only make the call.
 *
 * Result of interpretModelOutput:
 *   { status: 'ok', rule, assumptions: string[] }
 *   { status: 'unresolvable', message }   — no target, type or amount; ask the user for it
 *   { status: 'invalid', message }        — fields present but not a valid rule (e.g. 150%)
 */

import { validateRule } from '../src/engine/discountRule.js'

export const MAX_RULE_TEXT_LENGTH = 300

// Plain types and enums only, so every provider's structured-output mode
// accepts it. "unknown" / 0 / "" stand in for missing values; the validator
// below decides what is acceptable.
export const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'scope',
    'appliesTo',
    'type',
    'value',
    'stackable',
    'minCartValue',
    'assumptions',
    'clarification',
  ],
  properties: {
    scope: { type: 'string', enum: ['brand', 'platform', 'cart', 'unknown'] },
    appliesTo: { type: 'string' },
    type: { type: 'string', enum: ['percentage', 'flat', 'unknown'] },
    value: { type: 'number' },
    stackable: { type: 'boolean' },
    minCartValue: { type: 'number' },
    assumptions: { type: 'array', items: { type: 'string' } },
    clarification: { type: 'string' },
  },
}

export const SYSTEM_PROMPT = `You extract ONE discount rule from a shop manager's plain-English text into JSON for a checkout pricing engine. Fill every field from the text.

Fields:
- scope: "brand" (every product of one brand), "platform" (every product sold on one marketplace, e.g. Amazon India, Flipkart, Noon), "cart" (the whole cart total, usually above a minimum cart value), or "unknown" if the text doesn't say.
- appliesTo: the brand or platform name. If it matches a name in the known lists (ignoring case or small spelling differences), copy that exact spelling. "" for cart rules or when unknown.
- type: "percentage", "flat" (a fixed rupee amount), or "unknown" if the text gives no amount.
- value: the number exactly as written: 20 for "20%", 100 for "Rs.100". 0 if the text gives no number.
- stackable: true only if the text says the offer combines or stacks with other offers; otherwise false.
- minCartValue: for cart rules, the cart total threshold in rupees, or 0 if the rule applies to every cart. 0 for brand and platform rules.
- assumptions: short notes only where you had to interpret something the text doesn't state exactly, e.g. "Read 'more than Rs.5,000' as a minimum cart value of Rs.5,000", or where part of the text was left out. Don't restate what the text says plainly. Usually empty.
- clarification: "" whenever scope, type and value are all known. Otherwise one sentence telling the user what to add.

The rule is incomplete, and needs a clarification, only when:
- there is no discount amount, or it is vague ("a discount", "something off");
- a condition has no number ("for big orders", "for loyal customers");
- it is unclear whether the rule targets a brand, a platform or the whole cart;
- the text describes more than one rule, or is not a discount rule at all.
Never invent a number that is not in the text. Do not judge whether a value is sensible; copy it and let the engine validate it.`

const nameList = (names) => (names.length > 0 ? names.join(', ') : '(none loaded)')

export function buildUserMessage({ text, knownBrands = [], knownPlatforms = [], previousError }) {
  const retryNote = previousError
    ? `\n\nYour previous answer for this text was rejected: ${previousError}. Read the text again and correct it.`
    : ''
  return (
    `Known brands: ${nameList(knownBrands)}\n` +
    `Known platforms: ${nameList(knownPlatforms)}\n\n` +
    `<rule_text>\n${text}\n</rule_text>` +
    retryNote
  )
}

/**
 * Providers return one of:
 *   { kind: 'json', text }   — the model's answer
 *   { kind: 'refusal' }      — the model declined
 *   { kind: 'truncated' }    — the answer was cut off
 */
export function interpretModelOutput(output) {
  if (output.kind === 'refusal') {
    return { status: 'unresolvable', message: 'This text could not be processed. Describe a single discount rule.' }
  }
  if (output.kind === 'truncated') {
    return { status: 'invalid', message: 'The rule parser gave an incomplete answer. Please try again.' }
  }
  let parsed
  try {
    parsed = JSON.parse(output.text ?? '')
  } catch {
    return { status: 'invalid', message: 'The rule parser returned something that is not a rule. Please try again.' }
  }
  return interpretParsedRule(parsed)
}

const VAGUE_MESSAGE =
  'That description is too vague. Say how much off, and which brand, platform or cart total it applies to.'

/**
 * Maps the model's JSON onto a validated rule; a bad answer becomes a message,
 * not a crash. The model only extracts fields. Whether the rule is complete is
 * decided here, by code, so a model that wrongly gives up on a clear rule
 * can't block it.
 */
export function interpretParsedRule(parsed) {
  const clarification = typeof parsed?.clarification === 'string' ? parsed.clarification.trim() : ''
  const missingCore =
    !parsed || typeof parsed !== 'object' ||
    parsed.scope === 'unknown' || parsed.type === 'unknown' ||
    !(Number(parsed.value) > 0)
  if (missingCore) {
    return { status: 'unresolvable', message: clarification || VAGUE_MESSAGE }
  }

  const { rule, errors } = validateRule({
    ruleId: 'PENDING',
    scope: parsed?.scope,
    appliesTo: parsed?.appliesTo,
    type: parsed?.type,
    value: parsed?.value,
    stackable: parsed?.stackable,
    minCartValue: parsed?.scope === 'cart' ? parsed?.minCartValue : undefined,
  })
  if (!rule) {
    return {
      status: 'invalid',
      message: `The rule couldn't be understood: ${errors.join('; ')}. Try rephrasing it.`,
    }
  }

  const { ruleId, ...ruleWithoutId } = rule
  // A leftover clarification on a complete rule is ignored: in testing it was
  // mostly noise, and anything left out of the text shows up in assumptions.
  const assumptions = Array.isArray(parsed.assumptions)
    ? parsed.assumptions.filter((a) => typeof a === 'string' && a.trim()).slice(0, 3)
    : []
  return { status: 'ok', rule: ruleWithoutId, assumptions }
}
