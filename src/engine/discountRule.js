/**
 * discountRule.js
 *
 * The single definition of what a valid DiscountRule and CartItem look like.
 * Every input path (CSV, natural language, PDF, and anything added later)
 * turns its raw data into candidate objects and passes them through these
 * validators before they reach the engine. The engine itself trusts its input.
 *
 * DiscountRule {
 *   ruleId:       string
 *   scope:        "brand" | "platform" | "cart"
 *   appliesTo:    string        — brand or platform name; "" for cart rules
 *   type:         "percentage" | "flat"
 *   value:        number        — 15 = 15%, or rupees for flat
 *   stackable:    boolean
 *   minCartValue: number | null — cart rules only: applies when cart total >= this
 * }
 *
 * CartItem {
 *   itemId, product, brand, platform: string
 *   basePrice: number           — whole rupees
 * }
 */

export const RULE_SCOPES = ['brand', 'platform', 'cart']
export const RULE_TYPES = ['percentage', 'flat']

const isBlank = (v) => v === undefined || v === null || String(v).trim() === ''

/**
 * Parses a rupee amount written the way people write it:
 * 1299, "1,299", "Rs.1,299", "Rs 1299", "₹1,299.00", "INR 1299".
 * Returns NaN when the text is not a plain amount.
 */
export function parseRupees(input) {
  if (typeof input === 'number') return input
  if (isBlank(input)) return NaN
  const cleaned = String(input)
    .trim()
    .replace(/^(rs\.?|inr|₹)\s*/i, '')
    .replace(/,/g, '')
    .trim()
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return NaN
  return Number(cleaned)
}

/**
 * Parses "true"/"false"/"yes"/"no"/"1"/"0" (any case) or a boolean.
 * Returns null when the value is not recognisable.
 */
export function parseBoolean(input) {
  if (typeof input === 'boolean') return input
  const s = String(input ?? '').trim().toLowerCase()
  if (['true', 'yes', 'y', '1'].includes(s)) return true
  if (['false', 'no', 'n', '0'].includes(s)) return false
  return null
}

/**
 * Validates and normalises a candidate rule.
 * Returns { rule, errors } — rule is null when errors is non-empty.
 */
export function validateRule(candidate) {
  const errors = []
  const c = candidate ?? {}

  const ruleId = isBlank(c.ruleId) ? '' : String(c.ruleId).trim()
  if (!ruleId) errors.push('rule ID is missing')

  const scope = String(c.scope ?? '').trim().toLowerCase()
  if (!RULE_SCOPES.includes(scope)) {
    errors.push(`scope must be one of ${RULE_SCOPES.join(', ')} (got "${c.scope ?? ''}")`)
  }

  const type = String(c.type ?? '').trim().toLowerCase()
  if (!RULE_TYPES.includes(type)) {
    errors.push(`type must be "percentage" or "flat" (got "${c.type ?? ''}")`)
  }

  const value = typeof c.value === 'number' ? c.value : parseRupees(c.value)
  if (!Number.isFinite(value) || value <= 0) {
    errors.push(`value must be a positive number (got "${c.value ?? ''}")`)
  } else if (type === 'percentage' && value > 100) {
    errors.push(`a percentage discount cannot exceed 100% (got ${value}%)`)
  }

  const stackable = parseBoolean(c.stackable)
  if (stackable === null) errors.push(`stackable must be true or false (got "${c.stackable ?? ''}")`)

  let appliesTo = isBlank(c.appliesTo) ? '' : String(c.appliesTo).trim()
  let minCartValue = null

  if (scope === 'cart') {
    appliesTo = ''
    if (isBlank(c.minCartValue)) {
      minCartValue = 0 // a cart rule without a threshold applies to every cart
    } else {
      minCartValue = parseRupees(c.minCartValue)
      if (!Number.isFinite(minCartValue) || minCartValue < 0) {
        errors.push(`minimum cart value must be a non-negative amount (got "${c.minCartValue}")`)
      }
    }
  } else if (RULE_SCOPES.includes(scope) && !appliesTo) {
    errors.push(`a ${scope} rule needs a ${scope} name to apply to`)
  }

  if (errors.length > 0) return { rule: null, errors }
  return {
    rule: { ruleId, scope, appliesTo, type, value, stackable, minCartValue },
    errors: [],
  }
}

/**
 * Validates and normalises a candidate cart item.
 * Returns { item, errors } — item is null when errors is non-empty.
 */
export function validateCartItem(candidate) {
  const errors = []
  const c = candidate ?? {}
  const text = (v) => (isBlank(v) ? '' : String(v).trim().replace(/\s+/g, ' '))

  const itemId = text(c.itemId)
  const product = text(c.product)
  const brand = text(c.brand)
  const platform = text(c.platform)
  if (!itemId) errors.push('item ID is missing')
  if (!product) errors.push('product is missing')
  if (!brand) errors.push('brand is missing')
  if (!platform) errors.push('platform is missing')

  const price = parseRupees(c.basePrice)
  if (isBlank(c.basePrice)) errors.push('base price is missing')
  else if (!Number.isFinite(price) || price <= 0) {
    errors.push(`base price must be a positive amount (got "${c.basePrice}")`)
  }

  if (errors.length > 0) return { item: null, errors }
  return {
    item: { itemId, product, brand, platform, basePrice: Math.round(price) },
    errors: [],
  }
}
