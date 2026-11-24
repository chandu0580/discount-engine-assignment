/**
 * ruleTextParser.js
 *
 * Input adapter (browser): plain-English rule text → candidate DiscountRule.
 * Calls the /api/parse-rule endpoint, then validates the answer again here:
 * the network response is never trusted to be a valid rule.
 *
 * Returns one of:
 *   { status: 'ok', rule, assumptions }   — rule has no ruleId yet; the app assigns one on confirm
 *   { status: 'unresolvable', message }   — the text is too vague; show the message
 *   { status: 'invalid' | 'error', message }
 */

import { validateRule } from '../../engine/discountRule.js'

export async function parseRuleText(text, { knownBrands = [], knownPlatforms = [] } = {}, fetchImpl = fetch) {
  const trimmed = String(text ?? '').trim()
  if (!trimmed) return { status: 'unresolvable', message: 'Describe a discount rule first.' }

  let response
  try {
    response = await fetchImpl('/api/parse-rule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: trimmed, knownBrands, knownPlatforms }),
    })
  } catch {
    return { status: 'error', message: "Couldn't reach the rule parser. Check your connection and try again." }
  }

  let body = null
  try {
    body = await response.json()
  } catch {
    // handled below
  }

  if (!response.ok || !body) {
    return { status: 'error', message: body?.message ?? `The rule parser failed (HTTP ${response.status}).` }
  }
  if (body.status === 'unresolvable' || body.status === 'invalid') {
    return { status: body.status, message: String(body.message ?? 'The rule could not be understood.') }
  }
  if (body.status !== 'ok') {
    return { status: 'error', message: 'The rule parser returned an unexpected answer.' }
  }

  const { rule, errors } = validateRule({ ...body.rule, ruleId: 'PENDING' })
  if (!rule) {
    return { status: 'invalid', message: `The parsed rule is not valid: ${errors.join('; ')}.` }
  }
  const { ruleId, ...ruleWithoutId } = rule
  const assumptions = Array.isArray(body.assumptions)
    ? body.assumptions.filter((a) => typeof a === 'string' && a.trim())
    : []
  return { status: 'ok', rule: ruleWithoutId, assumptions }
}

/** One plain sentence a manager can check before confirming. */
export function describeRule(rule) {
  const amount = rule.type === 'percentage' ? `${rule.value}% off` : `Rs.${rule.value.toLocaleString('en-IN')} off`
  let target
  if (rule.scope === 'brand') target = `every ${rule.appliesTo} product`
  else if (rule.scope === 'platform') target = `every item sold on ${rule.appliesTo}`
  else if (rule.minCartValue > 0) {
    target = `the whole cart when the cart total is Rs.${rule.minCartValue.toLocaleString('en-IN')} or more`
  } else target = 'the whole cart'
  let stacking
  if (rule.scope === 'cart') {
    stacking = 'Applied after item discounts' + (rule.stackable ? ', and combines with other cart offers.' : '.')
  } else {
    stacking = rule.stackable
      ? 'Combines with other offers.'
      : "Doesn't combine with other non-stackable offers; the bigger saving wins."
  }
  return `${amount} ${target}. ${stacking}`
}
