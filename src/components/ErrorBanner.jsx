/**
 * ErrorBanner.jsx
 * Displays a list of parse or validation errors.
 * tone="warning" is used when the file still loaded but some rows were skipped.
 */

const TONES = {
  error: { bg: '#fce8e8', border: '#e57373', accent: '#c0392b', title: '#8a1a1a', text: '#5a1010' },
  warning: { bg: '#fff6e0', border: '#f0c36d', accent: '#d98e04', title: '#7a4b00', text: '#5a3a00' },
}

export default function ErrorBanner({ errors, tone = 'error', title }) {
  if (!errors || errors.length === 0) return null
  const t = TONES[tone] ?? TONES.error
  return (
    <div
      style={{
        background: t.bg,
        border: `1px solid ${t.border}`,
        borderLeft: `3px solid ${t.accent}`,
        borderRadius: 4,
        padding: '0.6rem 0.9rem',
        marginTop: '0.5rem',
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 12, color: t.title, marginBottom: 4 }}>
        {title ?? `${errors.length} issue${errors.length > 1 ? 's' : ''} found`}
      </div>
      {errors.map((e, i) => (
        <div key={i} style={{ fontSize: 12, color: t.text, marginTop: 2 }}>
          {e}
        </div>
      ))}
    </div>
  )
}
