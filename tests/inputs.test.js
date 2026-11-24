import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseRulesCSV, parseCartCSV } from '../src/inputs/csv/csvParser.js'
import { validateRule, validateCartItem, parseRupees } from '../src/engine/discountRule.js'

test('rules CSV: the original 6-column format still loads', () => {
  const csv = 'rule_id,scope,applies_to,type,value,stackable\nRULE-01,platform,Amazon India,percentage,15,false'
  const { data, errors } = parseRulesCSV(csv)
  assert.deepEqual(errors, [])
  assert.equal(data[0].minCartValue, null)
})

test('rules CSV: bad rows are reported with their row number and skipped', () => {
  const csv = [
    'rule_id,scope,applies_to,type,value,stackable,min_cart_value',
    'RULE-01,platform,Amazon India,percentage,15,false,',
    'RULE-02,brand,,flat,150,false,',
    'RULE-03,platform,Flipkart,percentage,150,true,',
    'RULE-04,cart,,percentage,10,maybe,4000',
    'RULE-01,brand,Natura Casa,flat,50,false,',
  ].join('\n')
  const { data, errors } = parseRulesCSV(csv)
  assert.deepEqual(data.map((r) => r.ruleId), ['RULE-01'])
  assert.equal(errors.length, 4)
  assert.match(errors[0], /^Row 3: a brand rule needs a brand name/)
  assert.match(errors[1], /^Row 4: a percentage discount cannot exceed 100%/)
  assert.match(errors[2], /^Row 5: stackable must be true or false/)
  assert.match(errors[3], /^Row 6: duplicate rule ID/)
})

test('rules CSV: a missing required column is a clear error', () => {
  const { data, errors } = parseRulesCSV('rule_id,scope,value\nR,brand,10')
  assert.deepEqual(data, [])
  assert.match(errors[0], /Missing column\(s\): type, stackable/)
})

test('cart CSV: prices written as rupees with commas are accepted', () => {
  const { data } = parseCartCSV('item_id,product,brand,platform,base_price\nI1,Vase,LivSpace Pro,Noon,"Rs.2,499"')
  assert.equal(data[0].basePrice, 2499)
})

test('parseRupees handles common formats and rejects text', () => {
  assert.equal(parseRupees('Rs.1,299'), 1299)
  assert.equal(parseRupees('₹ 849'), 849)
  assert.equal(parseRupees('INR 599.50'), 599.5)
  assert.ok(Number.isNaN(parseRupees('Rs.abc')))
  assert.ok(Number.isNaN(parseRupees('')))
})

test('validateRule: cart rules get a threshold and drop appliesTo', () => {
  const { rule } = validateRule({ ruleId: 'C', scope: 'cart', appliesTo: 'x', type: 'percentage', value: 10, stackable: false, minCartValue: '5,000' })
  assert.equal(rule.appliesTo, '')
  assert.equal(rule.minCartValue, 5000)
})

test('validateCartItem: lists every missing field', () => {
  const { item, errors } = validateCartItem({ itemId: 'I', product: 'Vase' })
  assert.equal(item, null)
  assert.deepEqual(errors, ['brand is missing', 'platform is missing', 'base price is missing'])
})
