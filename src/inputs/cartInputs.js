/**
 * cartInputs.js
 *
 * Registry of cart input formats. Each adapter turns an uploaded file into
 * { data: CartItem[], errors: string[] } using the shared validators; the
 * engine never sees the original format.
 *
 * To add a third format (e.g. .xlsx), write an adapter and add one entry here.
 * Nothing in src/engine needs to change.
 */

import { parseCartCSV } from './csv/csvParser.js'

export const CART_INPUTS = [
  {
    extension: '.csv',
    read: (file) => file.text().then(parseCartCSV),
  },
  {
    extension: '.pdf',
    read: async (file) => {
      const { parseCartPDF } = await import('./pdf/pdfCartParser.js')
      return parseCartPDF(await file.arrayBuffer())
    },
  },
]

export const CART_ACCEPT = CART_INPUTS.map((i) => i.extension).join(',')

export async function readCartFile(file) {
  const name = file.name.toLowerCase()
  const input = CART_INPUTS.find((i) => name.endsWith(i.extension))
  if (!input) {
    return { data: [], errors: [`Unsupported file type. Upload one of: ${CART_ACCEPT}`] }
  }
  return input.read(file)
}
