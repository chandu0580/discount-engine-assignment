/**
 * cartTable.js
 *
 * Pure function: turns positioned text lines from a PDF into CartItem objects.
 * No pdf.js dependency, so it can be unit-tested with hand-made lines.
 *
 * Input: lines in reading order, each an array of text runs
 *   { str: string, x: number, width: number }   (x and width in PDF units)
 *
 * PDFs store tables in two common ways, and both are handled:
 *   - one text run per cell (most generators), or
 *   - one text run per line, padded with spaces (monospace exports like the
 *     sample in the brief).
 * Every run is split into characters with an x position, and each character
 * is assigned to the column whose header starts at or just left of it.
 */

import { validateCartItem } from '../../engine/discountRule.js'

const COLUMNS = [
  { field: 'product', labels: ['product'] },
  { field: 'brand', labels: ['brand'] },
  { field: 'platform', labels: ['platform'] },
  { field: 'basePrice', labels: ['base price', 'price'] },
]

const SEPARATOR_LINE = /^[\s\-─━_=—–|+]+$/

/** Explodes runs into positioned characters and rebuilds the line text. */
function layoutLine(runs) {
  const chars = []
  for (const run of runs) {
    const str = run.str ?? ''
    if (!str) continue
    const charWidth = (run.width || str.length * 5) / str.length
    for (let i = 0; i < str.length; i++) {
      chars.push({ ch: str[i], x: run.x + i * charWidth, w: charWidth })
    }
  }
  chars.sort((a, b) => a.x - b.x)

  // Rebuild text, inserting spaces where runs leave a visual gap
  const positioned = []
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]
    const prev = chars[i - 1]
    if (prev && !/\s/.test(prev.ch) && !/\s/.test(c.ch)) {
      const gap = c.x - (prev.x + prev.w)
      if (gap > prev.w * 1.5) {
        positioned.push({ ch: ' ', x: prev.x + prev.w, w: 0 }, { ch: ' ', x: prev.x + prev.w, w: 0 })
      } else if (gap > prev.w * 0.25) {
        positioned.push({ ch: ' ', x: prev.x + prev.w, w: 0 })
      }
    }
    positioned.push(c)
  }
  return { text: positioned.map((c) => c.ch).join(''), chars: positioned }
}

/** Finds the column start positions if this line is the table header. */
function detectHeader(layout) {
  const lower = layout.text.toLowerCase()
  const columns = []
  for (const col of COLUMNS) {
    const label = col.labels.find((l) => lower.includes(l))
    if (!label) return null
    columns.push({ field: col.field, x: layout.chars[lower.indexOf(label)].x })
  }
  return columns.sort((a, b) => a.x - b.x)
}

const collapse = (s) => s.replace(/\s+/g, ' ').trim()

/** Assigns each character of a line to a column by its x position. */
function splitByColumns(layout, columns) {
  const cells = Object.fromEntries(columns.map((c) => [c.field, '']))
  for (const c of layout.chars) {
    const tolerance = Math.max(c.w, 1) * 0.6
    let col = columns[0]
    for (const candidate of columns) {
      if (candidate.x <= c.x + tolerance) col = candidate
    }
    cells[col.field] += c.ch
  }
  for (const key of Object.keys(cells)) cells[key] = collapse(cells[key])

  // Fallback for lines that drift out of alignment: if the line splits into
  // exactly one chunk per column on wide gaps, trust that instead.
  if (Object.values(cells).some((v) => !v)) {
    const parts = layout.text.trim().split(/\s{2,}/)
    if (parts.length === columns.length) {
      columns.forEach((col, i) => (cells[col.field] = collapse(parts[i])))
    }
  }
  return cells
}

/**
 * Returns { data: CartItem[], errors: string[] }.
 * Rows that fail validation are left out and reported in errors, quoting the
 * original line so the user can find it in their PDF.
 */
export function parseCartTableLines(lines) {
  const layouts = lines.map(layoutLine)
  const headerIndex = layouts.findIndex((l) => detectHeader(l))
  if (headerIndex === -1) {
    return {
      data: [],
      errors: [
        'Could not find the cart table. The PDF needs a header row with Product, Brand, Platform and Base Price columns.',
      ],
    }
  }

  const columns = detectHeader(layouts[headerIndex])
  const data = []
  const errors = []
  let rowNumber = 0

  for (const layout of layouts.slice(headerIndex + 1)) {
    const raw = collapse(layout.text)
    if (!raw || SEPARATOR_LINE.test(raw)) continue
    if (detectHeader(layout)) continue // header repeated on a later page

    rowNumber += 1
    const cells = splitByColumns(layout, columns)
    const { item, errors: rowErrors } = validateCartItem({
      itemId: `ITEM-${String(data.length + 1).padStart(2, '0')}`,
      ...cells,
    })
    if (item) data.push(item)
    else errors.push(`Row ${rowNumber} ("${raw}"): ${rowErrors.join('; ')}`)
  }

  if (data.length === 0 && errors.length === 0) {
    errors.push('The cart table in this PDF has a header but no item rows.')
  }
  return { data, errors }
}
