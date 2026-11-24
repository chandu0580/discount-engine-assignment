/**
 * discountEngine.js
 *
 * Pure discount calculation logic. No UI, no side effects, no knowledge of
 * where rules or cart items came from (CSV, PDF, natural language...).
 * All functions take plain objects and return plain objects.
 * Data shapes for DiscountRule and CartItem live in discountRule.js.
 *
 * DiscountResult {
 *   itemId, product, brand, platform: string
 *   basePrice:     number
 *   finalPrice:    number
 *   totalDiscount: number
 *   appliedRules:  string[]   — rule IDs, in the order they were applied
 *   skippedRules:  string[]   — matching non-stackable rules that gave a smaller saving
 *   status:        "max-discount" | "stacked" | "applied" | "none"
 *   reasoning:     string     — customer-readable explanation
 * }
 *
 * CartSummary {
 *   items:        DiscountResult[]
 *   subtotal:     number            — sum of item final prices
 *   cartOffers:   { ruleId, label, saving }[]   — empty when no cart rule is met
 *   total:        number            — subtotal minus cart offers
 *   nextCartOffer:{ ruleId, label, shortfall } | null — closest unmet cart rule,
 *                 only when no cart offer applies yet
 * }
 *
 * Rounding: every percentage saving is rounded to the nearest rupee at the
 * step where it is applied (Rs.194.85 → Rs.195). Customers only ever see
 * whole-rupee amounts, and each displayed saving adds up exactly.
 */

/**
 * Returns true if the rule applies to this cart item.
 * Cart-scope rules never match an individual item; they are handled by
 * applyCartOffers after item-level pricing.
 */
export function ruleMatchesItem(item, rule) {
  const normalise = (s) => String(s ?? '').trim().toLowerCase()
  if (rule.scope === 'brand') {
    return normalise(item.brand) === normalise(rule.appliesTo)
  }
  if (rule.scope === 'platform') {
    return normalise(item.platform) === normalise(rule.appliesTo)
  }
  return false
}

/**
 * Calculates the rupee discount a rule gives on a given price.
 * Uses the provided price, not the original base price — important for stacking.
 * Never returns more than the price itself, so a price can't go negative.
 */
export function calculateDiscountAmount(price, rule) {
  if (price <= 0) return 0
  if (rule.type === 'percentage') {
    return Math.min(price, Math.round((price * rule.value) / 100))
  }
  if (rule.type === 'flat') {
    return Math.min(price, rule.value)
  }
  return 0
}

/** "15% off" or "Rs.150 off" */
function describeValue(rule) {
  return rule.type === 'percentage'
    ? `${rule.value}% off`
    : `Rs.${rule.value.toLocaleString('en-IN')} off`
}

/** "Amazon India offer: 15% off" — names the offer the way a shopper sees it. */
function ruleToReasoning(rule) {
  const source = rule.scope === 'cart' ? 'Cart' : rule.appliesTo
  return `${source} offer: ${describeValue(rule)}`
}

/**
 * Shared selection logic for item and cart pricing:
 *   1. Among non-stackable rules, the one giving the largest rupee saving wins.
 *      Ties keep the rule that was listed first.
 *   2. The winner is applied first, then every stackable rule in list order,
 *      each on the already-discounted price.
 * Returns the final price and one step per applied rule.
 */
function applyRuleSet(startPrice, rules) {
  const nonStackable = rules.filter((r) => !r.stackable)
  const stackable = rules.filter((r) => r.stackable)

  let winner = null
  let skipped = []
  if (nonStackable.length > 0) {
    const sorted = [...nonStackable].sort(
      (a, b) => calculateDiscountAmount(startPrice, b) - calculateDiscountAmount(startPrice, a)
    )
    winner = sorted[0]
    skipped = sorted.slice(1)
  }

  let price = startPrice
  const steps = []
  for (const rule of winner ? [winner, ...stackable] : stackable) {
    const saving = calculateDiscountAmount(price, rule)
    const capped = rule.type === 'flat' && saving < rule.value
    price -= saving
    steps.push({ rule, saving, capped })
  }

  return { finalPrice: price, steps, skipped }
}

/**
 * Applies the active discount rules to a single cart item.
 * Returns a DiscountResult.
 */
export function applyDiscounts(item, rules) {
  const base = {
    itemId: item.itemId,
    product: item.product,
    brand: item.brand,
    platform: item.platform,
    basePrice: item.basePrice,
  }

  const matchingRules = rules.filter((r) => ruleMatchesItem(item, r))

  if (matchingRules.length === 0) {
    return {
      ...base,
      finalPrice: item.basePrice,
      totalDiscount: 0,
      appliedRules: [],
      skippedRules: [],
      status: 'none',
      reasoning: 'No offers available',
    }
  }

  const { finalPrice, steps, skipped } = applyRuleSet(item.basePrice, matchingRules)

  let reasoning = steps
    .map((s) => ruleToReasoning(s.rule) + (s.capped ? ' (capped at the item price)' : ''))
    .join(' + ')
  if (steps.length > 1) reasoning += ' (combined)'
  if (skipped.length > 0) {
    reasoning += ` — better than ${skipped.map(ruleToReasoning).join(', ')}`
  }

  let status = 'applied'
  if (steps.length > 1) status = 'stacked'
  else if (skipped.length > 0) status = 'max-discount'

  return {
    ...base,
    finalPrice,
    totalDiscount: item.basePrice - finalPrice,
    appliedRules: steps.map((s) => s.rule.ruleId),
    skippedRules: skipped.map((r) => r.ruleId),
    status,
    reasoning,
  }
}

/**
 * Runs applyDiscounts across every item in the cart.
 * Returns an array of DiscountResult objects.
 */
export function processCart(cartItems, rules) {
  return cartItems.map((item) => applyDiscounts(item, rules))
}

/**
 * Sums the final prices across all results.
 */
export function cartTotal(results) {
  return results.reduce((sum, r) => sum + r.finalPrice, 0)
}

/**
 * Applies cart-scope rules to the cart subtotal (the sum of item final prices).
 * A cart rule is eligible when subtotal >= its minCartValue. Eligible cart
 * rules follow the same best-non-stackable-plus-stackables logic as items.
 */
export function applyCartOffers(subtotal, rules) {
  const cartRules = rules.filter((r) => r.scope === 'cart')
  const eligible = cartRules.filter((r) => subtotal >= (r.minCartValue ?? 0))
  const unmet = cartRules
    .filter((r) => subtotal < (r.minCartValue ?? 0))
    .sort((a, b) => a.minCartValue - b.minCartValue)

  const { finalPrice, steps } = applyRuleSet(subtotal, eligible)
  const cartOffers = steps.map((s) => ({
    ruleId: s.rule.ruleId,
    label: `${ruleToReasoning(s.rule)} — Rs.${s.saving.toLocaleString('en-IN')} saved`,
    saving: s.saving,
  }))

  // Only nudge when no cart offer applies yet; comparing a met offer against a
  // bigger unmet one would need a "would you save more?" calculation the
  // customer can't easily verify.
  const next = cartOffers.length === 0 ? unmet[0] : undefined
  return {
    cartOffers,
    total: finalPrice,
    nextCartOffer: next
      ? {
          ruleId: next.ruleId,
          label: `${describeValue(next)} your cart`,
          shortfall: next.minCartValue - subtotal,
        }
      : null,
  }
}

/**
 * Full pricing run: item-level discounts first, then cart-level offers.
 * Returns a CartSummary.
 */
export function calculateCart(cartItems, rules) {
  const items = processCart(cartItems, rules)
  const subtotal = cartTotal(items)
  return { items, subtotal, ...applyCartOffers(subtotal, rules) }
}
