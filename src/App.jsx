/**
 * App.jsx
 *
 * Top-level component. Holds the session state (rules, cart, results) and
 * wires each input adapter to the engine:
 *
 *   rules.csv ───────────┐
 *   plain-English rule ──┴─> rules ──┐
 *                                    ├─> calculateCart() ──> CartSummary
 *   cart.csv / cart.pdf ──> cart ────┘
 *
 * Results are derived from the current rules and cart, so adding a rule or
 * replacing the cart re-runs the engine automatically.
 */

import { useMemo, useRef, useState } from 'react'
import FileUploader from './components/FileUploader.jsx'
import DataTable from './components/DataTable.jsx'
import ErrorBanner from './components/ErrorBanner.jsx'
import RuleTextInput from './components/RuleTextInput.jsx'
import CartSummary from './components/CartSummary.jsx'
import { parseRulesCSV } from './inputs/csv/csvParser.js'
import { readCartFile, CART_ACCEPT } from './inputs/cartInputs.js'
import { calculateCart } from './engine/discountEngine.js'

const rs = (n) => `Rs.${n.toLocaleString('en-IN')}`
const titleCase = (v) => v.charAt(0).toUpperCase() + v.slice(1)

const CART_COLUMNS = [
  { key: 'itemId', label: 'Item' },
  { key: 'product', label: 'Product' },
  { key: 'brand', label: 'Brand' },
  { key: 'platform', label: 'Platform' },
  { key: 'basePrice', label: 'Base Price', render: (v) => rs(v) },
]

// ── Styles ───────────────────────────────────────────────────────

const S = {
  page:    { minHeight: '100vh', background: '#f7f7f9', fontFamily: 'Arial, sans-serif' },
  header:  { background: '#131A48', padding: '0.85rem 2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  logoTxt: { fontFamily: 'Georgia, serif', fontSize: 17, fontWeight: 700, color: '#fff', letterSpacing: '-0.02em' },
  logoSpan:{ color: '#FF5800' },
  headerSub: { fontSize: 11, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.07em' },
  main:    { maxWidth: 1060, margin: '0 auto', padding: '1.8rem 1.5rem' },
  section: { background: '#fff', border: '1px solid #CECECE', borderRadius: 6, padding: '1.2rem 1.4rem', marginBottom: '1.2rem' },
  sectionTitle: { fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: 14, color: '#131A48', marginBottom: '0.7rem', paddingBottom: 6, borderBottom: '2px solid #FF5800', display: 'inline-block' },
  hint:    { fontSize: 11, color: '#888', marginBottom: 4 },
  grid2:   { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: '1rem' },
  btn: {
    background: '#FF5800', color: '#fff', border: 'none', borderRadius: 4,
    padding: '0.65rem 2rem', fontSize: 13, fontWeight: 700, cursor: 'pointer',
    letterSpacing: '0.04em', textTransform: 'uppercase',
  },
  btnDisabled: {
    background: '#CECECE', color: '#fff', border: 'none', borderRadius: 4,
    padding: '0.65rem 2rem', fontSize: 13, fontWeight: 700, cursor: 'not-allowed',
    letterSpacing: '0.04em', textTransform: 'uppercase',
  },
  linkBtn: { border: 'none', background: 'none', color: '#c0392b', cursor: 'pointer', fontSize: 11, fontWeight: 700, padding: 0 },
}

// ── Component ────────────────────────────────────────────────────

export default function App() {
  const [csvRules, setCsvRules]           = useState([])
  const [addedRules, setAddedRules]       = useState([])
  const [rulesErrors, setRulesErrors]     = useState([])
  const [rulesFileName, setRulesFileName] = useState('')

  const [cartItems, setCartItems]       = useState([])
  const [cartIssues, setCartIssues]     = useState({ errors: [], partial: false })
  const [cartFileName, setCartFileName] = useState('')
  const [cartLoading, setCartLoading]   = useState(false)

  const [calculated, setCalculated] = useState(false)

  const nextRuleNumber = useRef(1)
  const cartUploadId = useRef(0)

  const rules = useMemo(() => [...csvRules, ...addedRules], [csvRules, addedRules])
  const summary = useMemo(
    () => (calculated && cartItems.length > 0 ? calculateCart(cartItems, rules) : null),
    [calculated, cartItems, rules]
  )

  // ── Handlers ──

  async function handleRulesFile(file) {
    const { data, errors } = parseRulesCSV(await file.text())
    setRulesErrors(errors)
    if (data.length === 0 && errors.length > 0) return // keep the current rules
    setCsvRules(data)
    setRulesFileName(file.name)
  }

  function handleAddRule(rule) {
    const ruleId = `NL-${String(nextRuleNumber.current++).padStart(2, '0')}`
    setAddedRules((prev) => [...prev, { ...rule, ruleId }])
  }

  function handleRemoveRule(ruleId) {
    setAddedRules((prev) => prev.filter((r) => r.ruleId !== ruleId))
  }

  async function handleCartFile(file) {
    const uploadId = ++cartUploadId.current
    setCartLoading(true)
    const { data, errors } = await readCartFile(file)
    if (uploadId !== cartUploadId.current) return // a newer upload replaced this one
    setCartLoading(false)

    if (data.length === 0) {
      // Nothing usable: keep the current cart rather than silently emptying it
      setCartIssues({ errors, partial: false })
      return
    }
    setCartItems(data)
    setCartIssues({ errors, partial: errors.length > 0 })
    setCartFileName(file.name)
    // A PDF replaces the cart and re-runs the engine straight away
    if (file.name.toLowerCase().endsWith('.pdf')) setCalculated(true)
  }

  const canCalculate = cartItems.length > 0

  const ruleColumns = [
    { key: 'ruleId', label: 'Rule ID' },
    { key: 'scope', label: 'Scope', render: titleCase },
    { key: 'appliesTo', label: 'Applies To', render: (v, row) => (row.scope === 'cart' ? 'Entire cart' : v) },
    { key: 'type', label: 'Type', render: titleCase },
    { key: 'value', label: 'Value', render: (v, row) => (row.type === 'percentage' ? `${v}% off` : `${rs(v)} off`) },
    { key: 'minCartValue', label: 'Condition', render: (v, row) => (row.scope === 'cart' && v > 0 ? `Cart ≥ ${rs(v)}` : '—') },
    { key: 'stackable', label: 'Stackable', render: (v) => (v ? 'Yes' : 'No') },
    {
      key: 'source',
      label: '',
      render: (_, row) =>
        row.ruleId.startsWith('NL-') ? (
          <button style={S.linkBtn} onClick={() => handleRemoveRule(row.ruleId)}>Remove</button>
        ) : null,
    },
  ]

  // ── Render ──

  return (
    <div style={S.page}>
      {/* Header */}
      <div style={S.header}>
        <div style={S.logoTxt}>O<span style={S.logoSpan}>pp</span>tra</div>
        <div style={S.headerSub}>Discount Engine</div>
      </div>

      <div style={S.main}>
        {/* Upload row */}
        <div style={S.grid2}>
          {/* Rules */}
          <div style={S.section}>
            <div style={S.sectionTitle}>Discount Rules</div>
            <FileUploader
              label="rules.csv"
              description="Upload your discount rules CSV"
              accept=".csv"
              onFile={handleRulesFile}
              hasData={csvRules.length > 0}
              fileName={rulesFileName}
            />
            <ErrorBanner errors={rulesErrors} />

            <div style={{ ...S.hint, marginTop: '1rem' }}>Or describe a rule in plain English</div>
            <RuleTextInput cartItems={cartItems} existingRules={rules} onAddRule={handleAddRule} />

            {rules.length > 0 && (
              <div style={{ marginTop: '0.9rem' }}>
                <div style={S.hint}>
                  {rules.length} active rule{rules.length > 1 ? 's' : ''}
                  {addedRules.length > 0 && ` (${addedRules.length} added in plain English, IDs NL-xx)`}
                </div>
                <DataTable columns={ruleColumns} rows={rules} />
              </div>
            )}
          </div>

          {/* Cart */}
          <div style={S.section}>
            <div style={S.sectionTitle}>Cart Items</div>
            <FileUploader
              label="cart.csv or cart.pdf"
              description="Upload your cart as a CSV or PDF (Product, Brand, Platform, Base Price)"
              accept={CART_ACCEPT}
              onFile={handleCartFile}
              hasData={cartItems.length > 0}
              fileName={cartFileName}
              busy={cartLoading}
            />
            <ErrorBanner
              errors={cartIssues.errors}
              tone={cartIssues.partial ? 'warning' : 'error'}
              title={
                cartIssues.partial
                  ? `${cartIssues.errors.length} row(s) couldn't be read and were left out of the cart`
                  : cartItems.length > 0
                    ? 'File not loaded. The previous cart is still active'
                    : undefined
              }
            />
            {cartItems.length > 0 && (
              <div style={{ marginTop: '0.75rem' }}>
                <div style={S.hint}>
                  {cartItems.length} item{cartItems.length > 1 ? 's' : ''} loaded
                </div>
                <DataTable columns={CART_COLUMNS} rows={cartItems} />
              </div>
            )}
          </div>
        </div>

        {/* Calculate button */}
        {!summary && (
          <div style={{ textAlign: 'center', marginBottom: '1.2rem' }}>
            <button
              style={canCalculate ? S.btn : S.btnDisabled}
              onClick={() => setCalculated(true)}
              disabled={!canCalculate}
            >
              Calculate Discounts
            </button>
            {!canCalculate && (
              <div style={{ fontSize: 11, color: '#888', marginTop: 6 }}>Upload a cart to calculate</div>
            )}
          </div>
        )}

        {/* Results */}
        {summary && (
          <div style={S.section}>
            <div style={S.sectionTitle}>Cart Summary</div>
            <div style={S.hint}>Updates automatically when rules or the cart change.</div>
            <CartSummary summary={summary} />
          </div>
        )}
      </div>
    </div>
  )
}
