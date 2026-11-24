/**
 * csvParser.js
 *
 * Input adapter: converts raw CSV text into DiscountRule / CartItem objects.
 * Uses papaparse for reliable CSV parsing, maps column names to the internal
 * shapes, then runs the shared validators from engine/discountRule.js.
 *
 * Expected rules.csv columns:
 *   rule_id, scope, applies_to, type, value, stackable, min_cart_value (optional)
 *
 * Expected cart.csv columns:
 *   item_id, product, brand, platform, base_price
 */

import Papa from 'papaparse'
import { validateRule, validateCartItem } from '../../engine/discountRule.js'

function parseCsv(csvText, requiredColumns) {
  const { data: rows, errors: parseErrors, meta } = Papa.parse(String(csvText).trim(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, '_'),
  })
  if (parseErrors.length > 0) {
    return { rows: [], errors: parseErrors.map((e) => `Row ${(e.row ?? 0) + 2}: ${e.message}`) }
  }
  const missingColumns = requiredColumns.filter((c) => !meta.fields?.includes(c))
  if (missingColumns.length > 0) {
    return { rows: [], errors: [`Missing column(s): ${missingColumns.join(', ')}`] }
  }
  return { rows, errors: [] }
}

/**
 * Parses the raw text of rules.csv into an array of DiscountRule objects.
 * Returns { data, errors } where errors is an array of row-level issues.
 */
export function parseRulesCSV(csvText) {
  const { rows, errors } = parseCsv(csvText, ['rule_id', 'scope', 'type', 'value', 'stackable'])
  const data = []
  const seenIds = new Set()

  rows.forEach((row, i) => {
    const rowNum = i + 2 // account for header row
    const { rule, errors: ruleErrors } = validateRule({
      ruleId: row.rule_id,
      scope: row.scope,
      appliesTo: row.applies_to,
      type: row.type,
      value: row.value,
      stackable: row.stackable,
      minCartValue: row.min_cart_value,
    })
    if (!rule) {
      errors.push(`Row ${rowNum}: ${ruleErrors.join('; ')}`)
      return
    }
    if (seenIds.has(rule.ruleId)) {
      errors.push(`Row ${rowNum}: duplicate rule ID "${rule.ruleId}" — row skipped`)
      return
    }
    seenIds.add(rule.ruleId)
    data.push(rule)
  })

  return { data, errors }
}

/**
 * Parses the raw text of cart.csv into an array of CartItem objects.
 * Returns { data, errors } where errors is an array of row-level issues.
 */
export function parseCartCSV(csvText) {
  const { rows, errors } = parseCsv(csvText, ['item_id', 'product', 'brand', 'platform', 'base_price'])
  const data = []

  rows.forEach((row, i) => {
    const rowNum = i + 2
    const { item, errors: itemErrors } = validateCartItem({
      itemId: row.item_id,
      product: row.product,
      brand: row.brand,
      platform: row.platform,
      basePrice: row.base_price,
    })
    if (!item) {
      errors.push(`Row ${rowNum}: ${itemErrors.join('; ')}`)
      return
    }
    data.push(item)
  })

  return { data, errors }
}
