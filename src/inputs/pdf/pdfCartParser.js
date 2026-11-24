/**
 * pdfCartParser.js
 *
 * Input adapter (browser): PDF file bytes → { data: CartItem[], errors }.
 * pdf.js is loaded only when a PDF is actually uploaded, so it does not
 * slow down the first page load.
 */

import { extractPdfLines } from './pdfText.js'
import { parseCartTableLines } from './cartTable.js'

async function loadPdfJs() {
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ])
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  return pdfjs
}

export async function parseCartPDF(arrayBuffer) {
  let lines
  try {
    lines = await extractPdfLines(arrayBuffer, await loadPdfJs())
  } catch (err) {
    const reason = err?.name === 'PasswordException' ? 'it is password-protected' : 'it is not a valid PDF'
    return { data: [], errors: [`Could not read this file: ${reason}.`] }
  }

  if (lines.length === 0) {
    return {
      data: [],
      errors: [
        'This PDF has no selectable text (it may be a scanned image). Upload a text-based PDF or a CSV instead.',
      ],
    }
  }
  return parseCartTableLines(lines)
}
