import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { extractPdfLines } from '../src/inputs/pdf/pdfText.js'
import { parseCartTableLines } from '../src/inputs/pdf/cartTable.js'
import { calculateCart } from '../src/engine/discountEngine.js'
import { makeMonospaceCartPdf, makeCellCartPdf, BRIEF_ROWS, MALFORMED_ROWS } from './fixtures/samplePdfs.js'

const parsePdf = async (bytes) => parseCartTableLines(await extractPdfLines(bytes, pdfjs))

const EXPECTED_ITEMS = BRIEF_ROWS.map(([product, brand, platform, price], i) => ({
  itemId: `ITEM-0${i + 1}`,
  product,
  brand,
  platform,
  basePrice: Number(price.replace(/[^\d]/g, '')),
}))

test('the PDF from the brief (one text run per line) becomes the sample cart', async () => {
  const { data, errors } = await parsePdf(await makeMonospaceCartPdf())
  assert.deepEqual(errors, [])
  assert.deepEqual(data, EXPECTED_ITEMS)
})

test('a PDF with one text run per cell parses the same way', async () => {
  const { data, errors } = await parsePdf(await makeCellCartPdf(BRIEF_ROWS))
  assert.deepEqual(errors, [])
  assert.deepEqual(data, EXPECTED_ITEMS)
})

test('the parsed PDF cart produces the brief totals with the sample rules', async () => {
  const { data } = await parsePdf(await makeMonospaceCartPdf())
  const rules = [
    { ruleId: 'RULE-01', scope: 'platform', appliesTo: 'Amazon India', type: 'percentage', value: 15, stackable: false, minCartValue: null },
    { ruleId: 'RULE-02', scope: 'brand', appliesTo: 'Natura Casa', type: 'flat', value: 150, stackable: false, minCartValue: null },
    { ruleId: 'RULE-03', scope: 'platform', appliesTo: 'Flipkart', type: 'percentage', value: 10, stackable: true, minCartValue: null },
    { ruleId: 'RULE-04', scope: 'cart', appliesTo: '', type: 'percentage', value: 10, stackable: false, minCartValue: 4000 },
  ]
  assert.equal(calculateCart(data, rules).total, 5339)
})

test('malformed rows are skipped and reported; good rows still load', async () => {
  const { data, errors } = await parsePdf(await makeCellCartPdf(MALFORMED_ROWS))
  assert.deepEqual(data.map((i) => [i.itemId, i.product, i.basePrice]), [
    ['ITEM-01', 'Cushion Cover', 1299],
    ['ITEM-02', 'Ceramic Vase', 2499],
  ])
  assert.equal(errors.length, 3)
  assert.match(errors[0], /^Row 2 \("Bed Sheet Set Natura Casa Flipkart"\): base price is missing/)
  assert.match(errors[1], /^Row 3 .*base price must be a positive amount \(got "Rs\.abc"\)/)
  assert.match(errors[2], /^Row 5 \("Total Rs\.3,798"\): brand is missing; platform is missing/)
})

test('a PDF without the expected header explains what is missing', () => {
  const lines = [[{ str: 'Invoice 123', x: 0, width: 60 }], [{ str: 'Vase  Rs.200', x: 0, width: 70 }]]
  const { data, errors } = parseCartTableLines(lines)
  assert.deepEqual(data, [])
  assert.match(errors[0], /header row with Product, Brand, Platform and Base Price/)
})

test('a file that is not a PDF is rejected by pdf.js', async () => {
  await assert.rejects(extractPdfLines(new TextEncoder().encode('item_id,product\n1,Vase'), pdfjs))
})
