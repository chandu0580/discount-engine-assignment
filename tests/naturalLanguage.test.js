import { test } from 'node:test'
import assert from 'node:assert/strict'
import { interpretParsedRule, interpretModelOutput, buildUserMessage } from '../server/ruleParsing.js'
import { callClaude, CLAUDE_MODEL } from '../server/providers/claude.js'
import { callOpenAiCompatible } from '../server/providers/openaiCompatible.js'
import { selectProvider, parseRule, checkAgainstText, numbersIn } from '../server/parseRule.js'
import { parseRuleText, describeRule } from '../src/inputs/naturalLanguage/ruleTextParser.js'
import handler from '../api/parse-rule.js'

const modelAnswer = (overrides) => ({
  scope: 'brand', appliesTo: 'Natura Casa', type: 'percentage', value: 20,
  stackable: true, minCartValue: 0, assumptions: [], clarification: '', ...overrides,
})

// ── Interpreting the model's JSON (no network) ──

test('the four brief examples map to the expected rules', () => {
  assert.deepEqual(interpretParsedRule(modelAnswer()).rule, {
    scope: 'brand', appliesTo: 'Natura Casa', type: 'percentage', value: 20, stackable: true, minCartValue: null,
  })
  assert.deepEqual(
    interpretParsedRule(modelAnswer({ scope: 'platform', appliesTo: 'Flipkart', type: 'flat', value: 100, stackable: false })).rule,
    { scope: 'platform', appliesTo: 'Flipkart', type: 'flat', value: 100, stackable: false, minCartValue: null }
  )
  const cart = interpretParsedRule(
    modelAnswer({ scope: 'cart', appliesTo: '', value: 10, stackable: false, minCartValue: 5000, assumptions: ["Read 'more than' as at least"] })
  )
  assert.equal(cart.rule.minCartValue, 5000)
  assert.deepEqual(cart.assumptions, ["Read 'more than' as at least"])

  const vague = interpretParsedRule(
    modelAnswer({ scope: 'cart', type: 'unknown', value: 0, clarification: 'How much off, and above what cart total?' })
  )
  assert.deepEqual(vague, { status: 'unresolvable', message: 'How much off, and above what cart total?' })
})

test('missing target, type or amount asks for detail, even without a model question', () => {
  for (const incomplete of [modelAnswer({ scope: 'unknown' }), modelAnswer({ type: 'unknown' }), modelAnswer({ value: 0 }), null, 'text']) {
    const result = interpretParsedRule(incomplete)
    assert.equal(result.status, 'unresolvable', JSON.stringify(incomplete))
    assert.match(result.message, /too vague/)
  }
})

test('a complete answer is never blocked by a leftover model question', () => {
  const result = interpretParsedRule(modelAnswer({ clarification: 'Please confirm the brand.' }))
  assert.equal(result.status, 'ok')
  assert.deepEqual(result.assumptions, [])
})

test('an invalid answer is retried once with the reason; vague input is not retried', async () => {
  const calls = []
  const answers = [modelAnswer({ scope: 'platform', appliesTo: '' }), modelAnswer()]
  const flaky = { call: async (input) => (calls.push(input), { kind: 'json', text: JSON.stringify(answers[calls.length - 1]) }) }
  const fixed = await parseRule({ text: '20% off Natura Casa', knownBrands: ['Natura Casa'] }, flaky)
  assert.equal(fixed.status, 'ok')
  assert.equal(calls.length, 2)
  assert.match(calls[1].previousError, /a platform rule needs a platform name/)
  assert.match(buildUserMessage(calls[1]), /Your previous answer for this text was rejected/)

  let vagueCalls = 0
  const vague = { call: async () => (vagueCalls++, { kind: 'json', text: JSON.stringify(modelAnswer({ type: 'unknown', value: 0 })) }) }
  assert.equal((await parseRule({ text: 'a discount for big orders' }, vague)).status, 'unresolvable')
  assert.equal(vagueCalls, 1)
})

test('"incomplete" is retried when the text clearly states an amount', async () => {
  // Seen live: "10% off if cart value is more than Rs.5,000" came back as "add the discount amount"
  const calls = []
  const answers = [
    modelAnswer({ scope: 'cart', appliesTo: '', type: 'unknown', value: 0, clarification: 'Please add the discount amount.' }),
    modelAnswer({ scope: 'cart', appliesTo: '', value: 10, stackable: false, minCartValue: 5000 }),
  ]
  const flaky = { call: async (input) => (calls.push(input), { kind: 'json', text: JSON.stringify(answers[calls.length - 1]) }) }
  const result = await parseRule({ text: '10% off if cart value is more than Rs.5,000' }, flaky)
  assert.equal(result.status, 'ok')
  assert.equal(result.rule.minCartValue, 5000)
  assert.match(calls[1].previousError, /the text states an amount/)
})

test('fields that are present but invalid become a message, not a crash', () => {
  for (const bad of [modelAnswer({ value: 150 }), modelAnswer({ appliesTo: '' }), modelAnswer({ scope: 'region' })]) {
    const result = interpretParsedRule(bad)
    assert.equal(result.status, 'invalid', JSON.stringify(bad))
    assert.match(result.message, /couldn't be understood/)
  }
})

test('describeRule reads like a sentence', () => {
  assert.equal(
    describeRule({ scope: 'cart', appliesTo: '', type: 'percentage', value: 10, stackable: false, minCartValue: 5000 }),
    '10% off the whole cart when the cart total is Rs.5,000 or more. Applied after item discounts.'
  )
})

// ── Providers, with fake clients ──

function fakeAnthropic(response) {
  const calls = []
  return { calls, beta: { messages: { create: async (params) => (calls.push(params), response) } } }
}

function fakeOpenAi(response) {
  const calls = []
  return { calls, chat: { completions: { create: async (params) => (calls.push(params), response) } } }
}

const input = { text: '20% off Natura Casa, stackable', knownBrands: ['Natura Casa'] }

test('Claude provider sends one structured-output request', async () => {
  const client = fakeAnthropic({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(modelAnswer()) }] })
  const output = await callClaude(input, { client })
  assert.equal(interpretModelOutput(output).status, 'ok')
  const [params] = client.calls
  assert.equal(params.model, CLAUDE_MODEL)
  assert.equal(params.output_config.format.type, 'json_schema')
  assert.match(params.messages[0].content, /Known brands: Natura Casa/)
  assert.ok(params.messages[0].content.endsWith('<rule_text>\n20% off Natura Casa, stackable\n</rule_text>'))
})

test('OpenAI-compatible provider sends a strict json_schema request', async () => {
  const client = fakeOpenAi({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(modelAnswer()) } }] })
  const output = await callOpenAiCompatible(input, { client })
  assert.equal(interpretModelOutput(output).status, 'ok')
  const [params] = client.calls
  assert.equal(params.response_format.type, 'json_schema')
  assert.equal(params.response_format.json_schema.strict, true)
  assert.equal(params.messages[0].role, 'system')
})

test('refusals, truncation and non-JSON answers are handled for both providers', async () => {
  assert.deepEqual(await callClaude(input, { client: fakeAnthropic({ stop_reason: 'refusal', content: [] }) }), { kind: 'refusal' })
  assert.deepEqual(await callClaude(input, { client: fakeAnthropic({ stop_reason: 'max_tokens', content: [] }) }), { kind: 'truncated' })
  assert.deepEqual(
    await callOpenAiCompatible(input, { client: fakeOpenAi({ choices: [{ finish_reason: 'stop', message: { refusal: 'no' } }] }) }),
    { kind: 'refusal' }
  )
  assert.deepEqual(
    await callOpenAiCompatible(input, { client: fakeOpenAi({ choices: [{ finish_reason: 'length', message: { content: '{"sta' } }] }) }),
    { kind: 'truncated' }
  )
  assert.equal(interpretModelOutput({ kind: 'refusal' }).status, 'unresolvable')
  assert.equal(interpretModelOutput({ kind: 'truncated' }).status, 'invalid')
  assert.equal(interpretModelOutput({ kind: 'json', text: 'Sure! Here you go' }).status, 'invalid')
})

// ── Checking the parsed rule against the user's text ──

const KNOWN = { knownBrands: ['Natura Casa', 'Nordic Basics'], knownPlatforms: ['Amazon India', 'Flipkart'] }
const check = (text, overrides) =>
  checkAgainstText(interpretParsedRule(modelAnswer(overrides)), { text, ...KNOWN })

test('numbers in the rule must appear in the text', () => {
  assert.deepEqual(numbersIn('10% off if cart value is more than Rs.5,000'), [10, 5000])
  assert.match(check('20% off Natura Casa', { value: 25 }).message, /amount 25 does not appear/)
  // Seen live: the model dropped the threshold
  const cart = { scope: 'cart', appliesTo: '', value: 10, stackable: false }
  assert.match(check('10% off if cart value is more than Rs.5,000', { ...cart, minCartValue: 0 }).message, /mentions 5000, but the rule has no minimum/)
  assert.match(check('10% off orders over Rs.5,000', { ...cart, minCartValue: 4000 }).message, /minimum cart value 4000 does not appear/)
  assert.equal(check('10% off if cart value is more than Rs.5,000', { ...cart, minCartValue: 5000 }).status, 'ok')
  assert.equal(check('10% off every cart', { ...cart, minCartValue: 0 }).status, 'ok')
})

test('the target must be a name the user wrote', () => {
  // Seen live: the Flipkart rule came back as "Amazon India"
  const wrong = check('Rs.100 flat discount on all Flipkart items', { scope: 'platform', appliesTo: 'Amazon India', type: 'flat', value: 100 })
  assert.deepEqual([wrong.rule.scope, wrong.rule.appliesTo], ['platform', 'Flipkart'])
  // Seen live: the brand name came back as the word "brand"
  assert.equal(check('20% off for Natura Casa brand, stackable', { appliesTo: 'brand' }).rule.appliesTo, 'Natura Casa')
  // Known spelling wins over the model's spelling
  assert.equal(check('Rs.50 off nordic basic products', { appliesTo: 'nordic basic', type: 'flat', value: 50 }).rule.appliesTo, 'Nordic Basics')
  // New names are fine if the user wrote them
  assert.equal(check('10% off Myntra', { scope: 'platform', appliesTo: 'Myntra', value: 10 }).rule.appliesTo, 'Myntra')
  // Two known names and the model's pick is neither: reject
  assert.match(check('20% off Natura Casa and Nordic Basics', { appliesTo: 'Home Decor' }).message, /"Home Decor" is not mentioned/)
})

test('provider selection: Anthropic first, then OpenAI-compatible, else none', () => {
  assert.equal(selectProvider({ ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'o' }).name, 'anthropic')
  assert.equal(selectProvider({ OPENAI_API_KEY: 'o' }).name, 'openai-compatible')
  assert.equal(selectProvider({}), null)
})

// ── Browser adapter, with a fake fetch ──

const fakeFetch = (status, body) => async () => ({ ok: status < 400, status, json: async () => body })

test('browser adapter re-validates whatever the server returns', async () => {
  const ok = await parseRuleText('x', {}, fakeFetch(200, { status: 'ok', rule: modelAnswer(), assumptions: [] }))
  assert.equal(ok.status, 'ok')
  assert.equal(ok.rule.ruleId, undefined)

  const tampered = await parseRuleText('x', {}, fakeFetch(200, { status: 'ok', rule: modelAnswer({ type: 'bogo' }) }))
  assert.equal(tampered.status, 'invalid')

  const down = await parseRuleText('x', {}, fakeFetch(503, { status: 'error', message: 'not configured' }))
  assert.deepEqual(down, { status: 'error', message: 'not configured' })

  const offline = await parseRuleText('x', {}, async () => { throw new TypeError('fetch failed') })
  assert.equal(offline.status, 'error')

  assert.equal((await parseRuleText('   ', {}, fakeFetch(200, {}))).status, 'unresolvable')
})

// ── HTTP handler guards (no API call reaches Claude) ──

async function callHandler(method, body) {
  const res = {
    statusCode: 200, headers: {}, body: '',
    setHeader(k, v) { this.headers[k] = v },
    end(s) { this.body = s },
  }
  await handler({ method, body }, res)
  return { status: res.statusCode, json: JSON.parse(res.body) }
}

test('API rejects bad requests before calling the model', async () => {
  const saved = { a: process.env.ANTHROPIC_API_KEY, o: process.env.OPENAI_API_KEY }
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.OPENAI_API_KEY
  try {
    assert.equal((await callHandler('GET')).status, 405)
    assert.equal((await callHandler('POST', { text: '  ' })).status, 400)
    assert.equal((await callHandler('POST', { text: 'x'.repeat(301) })).status, 400)
    assert.equal((await callHandler('POST', '{not json')).status, 400)
    const noKey = await callHandler('POST', JSON.stringify({ text: '10% off Flipkart' }))
    assert.equal(noKey.status, 503)
    assert.match(noKey.json.message, /ANTHROPIC_API_KEY or OPENAI_API_KEY/)
  } finally {
    if (saved.a !== undefined) process.env.ANTHROPIC_API_KEY = saved.a
    if (saved.o !== undefined) process.env.OPENAI_API_KEY = saved.o
  }
})
