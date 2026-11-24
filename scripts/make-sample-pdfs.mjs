/**
 * Writes the sample cart PDFs into sample-data/ for manual testing.
 *   node scripts/make-sample-pdfs.mjs
 *
 * sample-data/cart.pdf            — the table from the brief
 * sample-data/cart-malformed.pdf  — a missing price, a bad price and a totals line
 */

import fs from 'node:fs'
import { makeMonospaceCartPdf, makeCellCartPdf, MALFORMED_ROWS } from '../tests/fixtures/samplePdfs.js'

fs.writeFileSync('sample-data/cart.pdf', await makeMonospaceCartPdf())
fs.writeFileSync('sample-data/cart-malformed.pdf', await makeCellCartPdf(MALFORMED_ROWS))
console.log('Wrote sample-data/cart.pdf and sample-data/cart-malformed.pdf')
