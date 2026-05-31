// HTML → PDF via puppeteer-core. Shared by /nfe/danfe-pdf and the e-mail
// attachment in /nfe/enviar-email so the DANFE renders byte-for-byte the
// same on screen and on paper. Chromium lookup mirrors menuImport.js so
// the deploy already covers it.

import fs from 'fs'

function findChromiumPath() {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean)
  return candidates.find(p => { try { return fs.existsSync(p) } catch (_) { return false } }) || null
}

/**
 * Render an HTML string to a PDF Buffer.
 *
 * @param {string} html  Full HTML document. CSS @page rules and `printBackground`
 *                       are honored. Inline images (data URLs) work as-is.
 * @param {object} [opts]
 * @param {string} [opts.width='80mm'] Page width — DANFE thermal-receipt format.
 * @param {string} [opts.height='297mm'] Page height tall enough to fit any
 *                       reasonable DANFE without splitting across pages; the
 *                       template is short anyway and the unused area is
 *                       trimmed by viewers when printing.
 */
export async function renderHtmlToPdf(html, opts = {}) {
  const { width = '80mm', height = '297mm' } = opts

  let puppeteer
  try { puppeteer = (await import('puppeteer-core')).default }
  catch (e) { throw new Error('puppeteer-core não encontrado. Execute: npm install puppeteer-core') }

  const executablePath = findChromiumPath()
  if (!executablePath) {
    throw new Error('Chromium não encontrado. Em Docker, rode: docker compose build backend. Localmente, instale o Google Chrome.')
  }

  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-zygote'],
  })

  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'networkidle0' })
    const pdf = await page.pdf({
      width,
      height,
      printBackground: true,
      margin: { top: '5mm', right: '4mm', bottom: '5mm', left: '4mm' },
      preferCSSPageSize: false,
    })
    return pdf
  } finally {
    try { await browser.close() } catch (_) {}
  }
}

export default { renderHtmlToPdf }
