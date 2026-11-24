/**
 * pdfText.js
 *
 * Reads the text layer of a PDF with pdf.js and groups it into lines in
 * reading order (page by page, top to bottom). The pdf.js module is passed in
 * so the same code runs in the browser and in Node tests.
 */

/**
 * @param {ArrayBuffer|Uint8Array} data  the PDF file bytes
 * @param {object} pdfjs                 the pdf.js module (getDocument)
 * @returns {Promise<Array<Array<{str, x, width}>>>}
 */
export async function extractPdfLines(data, pdfjs) {
  // verbosity 0: only errors. Text extraction doesn't need the standard font
  // files pdf.js otherwise warns about.
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(data), verbosity: 0 })
  const lines = []

  try {
    const pdf = await loadingTask.promise
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
      const page = await pdf.getPage(pageNo)
      const { items } = await page.getTextContent()

      const runs = items
        .filter((it) => typeof it.str === 'string' && it.str.length > 0)
        .map((it) => ({
          str: it.str,
          x: it.transform[4],
          y: it.transform[5],
          width: it.width,
          height: it.height || Math.abs(it.transform[3]) || 10,
        }))
        .sort((a, b) => b.y - a.y || a.x - b.x)

      // Group runs whose baselines are within half a line height
      let current = null
      for (const run of runs) {
        if (current && Math.abs(current.y - run.y) <= Math.max(2, run.height * 0.5)) {
          current.runs.push(run)
        } else {
          current = { y: run.y, runs: [run] }
          lines.push(current.runs)
        }
      }
    }
  } finally {
    await loadingTask.destroy()
  }

  return lines.map((runs) => runs.sort((a, b) => a.x - b.x))
}
