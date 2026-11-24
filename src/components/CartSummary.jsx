/**
 * CartSummary.jsx
 *
 * Customer-facing results: each item's final price and offer, then the cart
 * subtotal, any cart offer as its own line, and the final total.
 */

import DataTable from './DataTable.jsx'

const rs = (n) => `Rs.${n.toLocaleString('en-IN')}`

const STATUS = {
  'max-discount': { label: 'Max discount', color: '#7a4b00', bg: '#fff0cc' },
  stacked: { label: 'Stacked', color: '#1a3f8a', bg: '#e3ebfb' },
  applied: { label: 'Discount applied', color: '#1e5c2c', bg: '#e1f3e5' },
  none: { label: 'No offer', color: '#666', bg: '#eee' },
}

function StatusBadge({ status }) {
  const s = STATUS[status] ?? STATUS.none
  return (
    <span
      style={{
        display: 'inline-block', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20,
        background: s.bg, color: s.color, textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap',
      }}
    >
      {s.label}
    </span>
  )
}

const COLUMNS = [
  { key: 'itemId', label: 'Item' },
  { key: 'product', label: 'Product' },
  { key: 'platform', label: 'Platform' },
  { key: 'basePrice', label: 'Base Price', render: (v) => rs(v) },
  {
    key: 'finalPrice',
    label: 'Final Price',
    render: (v, row) => (
      <span style={{ fontWeight: 700, color: row.totalDiscount > 0 ? '#1e5c2c' : '#131A48' }}>{rs(v)}</span>
    ),
  },
  {
    key: 'totalDiscount',
    label: 'You Save',
    render: (v) =>
      v > 0 ? <span style={{ color: '#1e5c2c', fontWeight: 600 }}>{rs(v)}</span> : <span style={{ color: '#888' }}>—</span>,
  },
  {
    key: 'reasoning',
    label: 'Offer Applied',
    render: (v, row) => (
      <span style={{ color: row.status === 'none' ? '#888' : '#131A48', fontStyle: row.status === 'none' ? 'italic' : 'normal' }}>
        {v}
      </span>
    ),
  },
  { key: 'status', label: 'Status', render: (v) => <StatusBadge status={v} /> },
]

const line = { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '0.35rem 0', fontSize: 13 }

export default function CartSummary({ summary }) {
  const { items, subtotal, cartOffers, total, nextCartOffer } = summary
  return (
    <div>
      <DataTable columns={COLUMNS} rows={items} emptyMessage="The cart is empty." />

      <div style={{ marginTop: '0.75rem', marginLeft: 'auto', maxWidth: 420, color: '#131A48' }}>
        <div style={line}>
          <span>{cartOffers.length > 0 ? 'Cart total before offer' : 'Cart total'}</span>
          <span style={{ fontWeight: 700 }}>{rs(subtotal)}</span>
        </div>

        {cartOffers.map((offer) => (
          <div key={offer.ruleId} style={{ ...line, color: '#1e5c2c', background: '#fff8e6', padding: '0.35rem 0.5rem', margin: '0 -0.5rem' }}>
            <span>{offer.label}</span>
            <span style={{ fontWeight: 700 }}>−{rs(offer.saving)}</span>
          </div>
        ))}

        <div style={{ ...line, borderTop: '2px solid #131A48', marginTop: 4, paddingTop: '0.5rem' }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>Final cart total</span>
          <span style={{ fontWeight: 700, fontSize: 17 }}>{rs(total)}</span>
        </div>

        {nextCartOffer && (
          <div style={{ fontSize: 12, color: '#7a4b00', marginTop: 4, textAlign: 'right' }}>
            Add {rs(nextCartOffer.shortfall)} more to get {nextCartOffer.label}.
          </div>
        )}
      </div>
    </div>
  )
}
