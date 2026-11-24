/**
 * RuleTextInput.jsx
 *
 * Natural-language rule input with a confirmation step:
 *   type a rule → parse → review the parsed fields → Confirm adds it / Discard drops it.
 * Nothing reaches the active rules until the user confirms.
 */

import { useState } from 'react'
import { parseRuleText, describeRule } from '../inputs/naturalLanguage/ruleTextParser.js'
import { ruleMatchesItem } from '../engine/discountEngine.js'

const EXAMPLES = [
  '20% off for Natura Casa brand, stackable with other offers',
  'Rs.100 flat discount on all Flipkart items',
  '10% off if cart value is more than Rs.5,000',
  'Give a discount for big orders',
]

const label = (s) => s.charAt(0).toUpperCase() + s.slice(1)

function parsedFields(rule) {
  const fields = [
    ['Scope', label(rule.scope)],
    rule.scope === 'cart' ? null : ['Applies to', rule.appliesTo],
    ['Type', label(rule.type)],
    ['Value', rule.type === 'percentage' ? `${rule.value}%` : `Rs.${rule.value.toLocaleString('en-IN')}`],
    ['Stackable', rule.stackable ? 'Yes' : 'No'],
    rule.scope === 'cart' ? ['Min cart value', `Rs.${rule.minCartValue.toLocaleString('en-IN')}`] : null,
  ]
  return fields.filter(Boolean)
}

/** Things worth flagging before the user confirms. */
function reviewWarnings(rule, cartItems, existingRules) {
  const warnings = []
  if (rule.scope !== 'cart' && cartItems.length > 0 && !cartItems.some((item) => ruleMatchesItem(item, rule))) {
    warnings.push(`No item in the current cart matches ${rule.scope} "${rule.appliesTo}", so this rule won't change today's prices.`)
  }
  const same = (a, b) =>
    a.scope === b.scope &&
    a.appliesTo.toLowerCase() === b.appliesTo.toLowerCase() &&
    a.type === b.type &&
    a.value === b.value &&
    a.stackable === b.stackable &&
    (a.minCartValue ?? null) === (b.minCartValue ?? null)
  const duplicate = existingRules.find((r) => same(r, rule))
  if (duplicate) warnings.push(`This is the same as ${duplicate.ruleId}, which is already active.`)
  return warnings
}

const box = (bg, border) => ({
  background: bg,
  border: `1px solid ${border}`,
  borderRadius: 4,
  padding: '0.7rem 0.9rem',
  marginTop: '0.7rem',
  fontSize: 12,
})

const button = (primary) => ({
  background: primary ? '#FF5800' : '#fff',
  color: primary ? '#fff' : '#131A48',
  border: primary ? 'none' : '1px solid #CECECE',
  borderRadius: 4,
  padding: '0.5rem 1.1rem',
  fontSize: 12,
  fontWeight: 700,
  cursor: 'pointer',
})

export default function RuleTextInput({ cartItems, existingRules, onAddRule }) {
  const [text, setText] = useState('')
  const [state, setState] = useState({ phase: 'idle' })

  const knownBrands = [...new Set(cartItems.map((i) => i.brand).concat(existingRules.filter((r) => r.scope === 'brand').map((r) => r.appliesTo)))]
  const knownPlatforms = [...new Set(cartItems.map((i) => i.platform).concat(existingRules.filter((r) => r.scope === 'platform').map((r) => r.appliesTo)))]

  const canParse = text.trim() !== '' && (state.phase === 'idle' || state.phase === 'message')

  async function handleParse(e) {
    e.preventDefault()
    if (!canParse) return
    setState({ phase: 'parsing' })
    const result = await parseRuleText(text, { knownBrands, knownPlatforms })
    setState(result.status === 'ok' ? { phase: 'review', ...result } : { phase: 'message', ...result })
  }

  function handleConfirm() {
    onAddRule(state.rule)
    setText('')
    setState({ phase: 'idle' })
  }

  return (
    <div>
      <form onSubmit={handleParse} style={{ display: 'flex', gap: '0.5rem' }}>
        <input
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            if (state.phase === 'message') setState({ phase: 'idle' })
          }}
          maxLength={300}
          placeholder='e.g. "Rs.100 flat discount on all Flipkart items"'
          disabled={state.phase === 'review'}
          style={{ flex: 1, padding: '0.55rem 0.7rem', fontSize: 13, border: '1px solid #CECECE', borderRadius: 4 }}
        />
        <button type="submit" disabled={!canParse} style={{ ...button(true), opacity: canParse ? 1 : 0.5 }}>
          {state.phase === 'parsing' ? 'Reading…' : 'Parse rule'}
        </button>
      </form>

      {state.phase !== 'review' && (
        <div style={{ marginTop: 6, fontSize: 11, color: '#888' }}>
          Try:{' '}
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => {
                setText(ex)
                setState({ phase: 'idle' })
              }}
              style={{ border: 'none', background: 'none', color: '#1a4fa0', cursor: 'pointer', fontSize: 11, padding: '0 6px 0 0', textDecoration: 'underline' }}
            >
              {ex}
            </button>
          ))}
        </div>
      )}

      {state.phase === 'message' && (
        <div style={state.status === 'unresolvable' ? box('#fff6e0', '#f0c36d') : box('#fce8e8', '#e57373')}>
          <strong>{state.status === 'unresolvable' ? 'Need a bit more detail. ' : 'Could not add this rule. '}</strong>
          {state.message}
        </div>
      )}

      {state.phase === 'review' && (
        <div style={box('#f4f6fb', '#c5cbe0')}>
          <div style={{ fontWeight: 700, color: '#131A48', marginBottom: 6 }}>Check the parsed rule before adding it</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem 1.2rem', marginBottom: 6 }}>
            {parsedFields(state.rule).map(([k, v]) => (
              <div key={k}>
                <span style={{ color: '#888', textTransform: 'uppercase', fontSize: 10, letterSpacing: '0.04em' }}>{k}</span>
                <div style={{ fontWeight: 700, color: '#131A48' }}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{ color: '#131A48' }}>{describeRule(state.rule)}</div>
          {[...state.assumptions.map((a) => `Assumption: ${a}`), ...reviewWarnings(state.rule, cartItems, existingRules)].map((w) => (
            <div key={w} style={{ color: '#7a4b00', marginTop: 4 }}>⚠ {w}</div>
          ))}
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.7rem' }}>
            <button type="button" style={button(true)} onClick={handleConfirm}>
              Confirm & add rule
            </button>
            <button type="button" style={button(false)} onClick={() => setState({ phase: 'idle' })}>
              Discard
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
