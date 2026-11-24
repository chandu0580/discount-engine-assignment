/**
 * samplePdfs.js
 *
 * Builds cart PDFs in memory for tests and for scripts/make-sample-pdfs.mjs.
 * Two layouts, because real PDFs store tables both ways:
 *   - makeMonospaceCartPdf: one text run per line (like the brief)
 *   - makeCellCartPdf: one text run per cell, proportional font
 */

import { PDFDocument, StandardFonts } from 'pdf-lib'

export const BRIEF_ROWS = [
  ['Cushion Cover', 'Natura Casa', 'Amazon India', 'Rs.1,299'],
  ['Bed Sheet Set', 'Natura Casa', 'Flipkart', 'Rs.849'],
  ['Wall Shelf', 'LivSpace Pro', 'Amazon India', 'Rs.599'],
  ['Ceramic Vase', 'LivSpace Pro', 'Noon', 'Rs.2,499'],
  ['Cutting Board', 'Nordic Basics', 'Amazon India', 'Rs.449'],
  ['Desk Organiser', 'Nordic Basics', 'Flipkart', 'Rs.899'],
]

const pad = (cells) =>
  cells[0].padEnd(17) + cells[1].padEnd(13) + ' ' + cells[2].padEnd(15) + cells[3]

/** Monospace layout: each line is a single text run, like the brief. */
export async function makeMonospaceCartPdf(rows = BRIEF_ROWS) {
  const doc = await PDFDocument.create()
  const page = doc.addPage([595, 842])
  const font = await doc.embedFont(StandardFonts.Courier)
  const lines = [
    'Order #OP-9921  |  Date: 15 Jan 2025',
    '',
    pad(['Product', 'Brand', 'Platform', 'Base Price']),
    '─'.repeat(58).replace(/─/g, '-'),
    ...rows.map(pad),
  ]
  lines.forEach((text, i) => page.drawText(text, { x: 50, y: 780 - i * 16, size: 10, font }))
  return doc.save()
}

/** Proportional font, one text run per cell, with three bad rows. */
export async function makeCellCartPdf(rows) {
  const doc = await PDFDocument.create()
  const page = doc.addPage([595, 842])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const colX = [50, 180, 290, 410]
  page.drawText('Order #OP-9922 | Date: 16 Jan 2025', { x: 50, y: 790, size: 11, font })
  ;['Product', 'Brand', 'Platform', 'Base Price'].forEach((h, i) =>
    page.drawText(h, { x: colX[i], y: 760, size: 10, font: bold })
  )
  rows.forEach((cells, r) =>
    cells.forEach((cell, i) => {
      if (cell) page.drawText(cell, { x: colX[i], y: 740 - r * 18, size: 10, font })
    })
  )
  return doc.save()
}

export const MALFORMED_ROWS = [
  ['Cushion Cover', 'Natura Casa', 'Amazon India', 'Rs.1,299'],
  ['Bed Sheet Set', 'Natura Casa', 'Flipkart', ''], // missing price
  ['Wall Shelf', 'LivSpace Pro', 'Amazon India', 'Rs.abc'], // unreadable price
  ['Ceramic Vase', 'LivSpace Pro', 'Noon', 'Rs.2,499'],
  ['Total', '', '', 'Rs.3,798'], // summary line, not an item
]
