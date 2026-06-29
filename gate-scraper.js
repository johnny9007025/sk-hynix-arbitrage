const puppeteer = require('puppeteer');

let browser = null;
let page = null;
let navInProgress = false;

async function init() {
  browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--single-process',
    ],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  });
  page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
  );

  page.on('framenavigated', () => { navInProgress = true; });
  page.on('domcontentloaded', () => { navInProgress = false; });

  await navigate();
}

async function navigate() {
  navInProgress = true;
  console.log('[Scraper] Loading page...');
  try {
    await page.goto('https://www.gate.com/zh-tw/stocks/000660', {
      waitUntil: 'networkidle2',
      timeout: 35000
    });
    await page.waitForTimeout(5000);
    console.log('[Scraper] Page loaded');
  } catch (err) {
    console.error('[Scraper] Navigation error:', err.message);
    await page.waitForTimeout(3000);
  }
  navInProgress = false;
}

async function waitForStable() {
  for (let i = 0; i < 20; i++) {
    if (!navInProgress) return true;
    await page.waitForTimeout(500);
  }
  return false;
}

async function scrapeBidAsk() {
  if (!page) await init();
  try {
    if (navInProgress) await waitForStable();

    const result = await page.evaluate(() => {
      const text = document.body.innerText;
      if (!text || text.includes('Access Denied') || text.includes('Cloudflare')) {
        return { _error: 'blocked' };
      }
      const baMatch = text.match(/買價\s*([\d,]+\.?\d*)\s*\n\s*([\d,]+\.?\d*)\s*\n\s*賣價/);
      const priceMatch = text.match(/([\d,]+\.\d{2})\s*≈\s*[\d,]+\.\d{2}\s*USD/);
      const highMatch = text.match(/今日最高價\s*([\d,]+\.?\d*)/);
      const lowMatch = text.match(/今日最低價\s*([\d,]+\.?\d*)/);
      const prevCloseMatch = text.match(/昨日收盤\s*([\d,]+\.?\d*)/);
      const parse = (m) => m ? parseFloat(m[1].replace(/,/g, '')) : null;
      return {
        bid: baMatch ? parseFloat(baMatch[1].replace(/,/g, '')) : null,
        ask: baMatch ? parseFloat(baMatch[2].replace(/,/g, '')) : null,
        price: parse(priceMatch),
        dayHigh: parse(highMatch),
        dayLow: parse(lowMatch),
        prevClose: parse(prevCloseMatch),
      };
    });

    if (result._error === 'blocked') {
      console.warn('[Scraper] Blocked by Cloudflare, reloading...');
      await navigate();
      return null;
    }

    if (result.bid && result.ask) {
      console.log(`[Scraper] Bid: ₩${result.bid.toLocaleString()} | Ask: ₩${result.ask.toLocaleString()} | Last: ₩${result.price?.toLocaleString() || 'N/A'}`);
      return result;
    }
    console.warn('[Scraper] Bid/ask not found, reloading...');
    await navigate();
    return null;
  } catch (err) {
    const msg = err.message || '';
    if (msg.includes('main frame') || msg.includes('detached') || msg.includes('Protocol')) {
      console.warn('[Scraper] Page in transition, waiting...');
      await page.waitForTimeout(3000);
      navInProgress = false;
    } else {
      console.error('[Scraper] Error:', msg);
      await navigate();
    }
    return null;
  }
}

async function close() {
  if (browser) await browser.close();
}

module.exports = { init, scrapeBidAsk, close };
