import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { calculateCart, applyDiscounts, applyCartOffers } from '../src/engine/discountEngine.js'
import { parseRulesCSV, parseCartCSV } from '../src/inputs/csv/csvParser.js'

const sampleRules = parseRulesCSV(fs.readFileSync('sample-data/rules.csv', 'utf8')).data
const sampleCart = parseCartCSV(fs.readFileSync('sample-data/cart.csv', 'utf8')).data

const rule = (overrides) => ({
  ruleId: 'R', scope: 'brand', appliesTo: 'Natura Casa', type: 'percentage',
  value: 10, stackable: false, minCartValue: null, ...overrides,
})

test('sample data matches the expected results table in the brief', () => {
  const summary = calculateCart(sampleCart, sampleRules)
  const rows = summary.items.map((r) => [r.itemId, r.finalPrice, r.status])
  assert.deepEqual(rows, [
    ['ITEM-01', 1104, 'max-discount'],
    ['ITEM-02', 629, 'stacked'],
    ['ITEM-03', 509, 'applied'],
    ['ITEM-04', 2499, 'none'],
    ['ITEM-05', 382, 'applied'],
    ['ITEM-06', 809, 'applied'],
  ])
  assert.equal(summary.subtotal, 5932)
  assert.deepEqual(summary.cartOffers, [
    { ruleId: 'RULE-04', label: 'Cart offer: 10% off — Rs.593 saved', saving: 593 },
  ])
  assert.equal(summary.total, 5339)
  assert.equal(summary.nextCartOffer, null)
})

test('reasoning strings explain the offer in customer terms', () => {
  const [item1, item2, , item4] = calculateCart(sampleCart, sampleRules).items
  assert.equal(item1.reasoning, 'Amazon India offer: 15% off — better than Natura Casa offer: Rs.150 off')
  assert.equal(item2.reasoning, 'Natura Casa offer: Rs.150 off + Flipkart offer: 10% off (combined)')
  assert.equal(item4.reasoning, 'No offers available')
})

test('cart offer applies at exactly the threshold and not one rupee below', () => {
  const cartRule = rule({ ruleId: 'C', scope: 'cart', appliesTo: '', minCartValue: 4000 })
  const atThreshold = applyCartOffers(4000, [cartRule])
  assert.equal(atThreshold.cartOffers.length, 1)
  assert.equal(atThreshold.total, 3600)

  const below = applyCartOffers(3999, [cartRule])
  assert.deepEqual(below.cartOffers, [])
  assert.equal(below.total, 3999)
  assert.deepEqual(below.nextCartOffer, { ruleId: 'C', label: '10% off your cart', shortfall: 1 })
})

test('cart rules never match individual items', () => {
  const result = applyDiscounts(sampleCart[3], [rule({ scope: 'cart', appliesTo: '', minCartValue: 0 })])
  assert.equal(result.status, 'none')
})

test('a flat discount larger than the price stops at zero', () => {
  const result = applyDiscounts(
    { itemId: 'X', product: 'Mug', brand: 'Natura Casa', platform: 'Noon', basePrice: 449 },
    [rule({ type: 'flat', value: 500 })]
  )
  assert.equal(result.finalPrice, 0)
  assert.equal(result.totalDiscount, 449)
  assert.match(result.reasoning, /capped at the item price/)
})

test('brief example: stackable 20% Natura Casa rule stacks on top of the winners', () => {
  const rules = [...sampleRules, rule({ ruleId: 'NL-01', value: 20, stackable: true })]
  const items = calculateCart(sampleCart, rules).items
  // ITEM-01: 15% wins (1104), then 20% → 1104 - 221 = 883
  assert.equal(items[0].finalPrice, 883)
  assert.deepEqual(items[0].appliedRules, ['RULE-01', 'NL-01'])
  assert.equal(items[0].status, 'stacked')
  // ITEM-02: 150 off (699), Flipkart 10% (629), then 20% → 629 - 126 = 503
  assert.equal(items[1].finalPrice, 503)
})

test('brief example: Rs.100 Flipkart rule loses to the bigger Natura Casa saving', () => {
  const rules = [...sampleRules, rule({ ruleId: 'NL-01', scope: 'platform', appliesTo: 'Flipkart', type: 'flat', value: 100 })]
  const items = calculateCart(sampleCart, rules).items
  assert.equal(items[1].finalPrice, 629) // RULE-02 (150) beats NL-01 (100)
  assert.deepEqual(items[1].skippedRules, ['NL-01'])
  assert.equal(items[5].finalPrice, 719) // 899 - 100 = 799, then Flipkart 10% (80)
})

test('brief example: second cart rule with an equal saving does not double up', () => {
  const rules = [...sampleRules, rule({ ruleId: 'NL-01', scope: 'cart', appliesTo: '', minCartValue: 5000 })]
  const summary = calculateCart(sampleCart, rules)
  assert.deepEqual(summary.cartOffers.map((o) => o.ruleId), ['RULE-04'])
  assert.equal(summary.total, 5339)
})
