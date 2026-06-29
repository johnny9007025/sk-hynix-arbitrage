const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const gateScraper = require('./gate-scraper');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const PORT = 3000;

const CONFIG = {
  OKX_INST_ID: 'SKHYNIX-USDT-SWAP',
  SLIPPAGE_BID: 3,
  SLIPPAGE_ASK: 3,
  POLL_INTERVAL: 3000,
  FX_CACHE_TTL: 3600000,
};

let state = {
  gate: {
    price_krw: 0,
    bid_krw: 0,
    ask_krw: 0,
    price_usd: 0,
    bid_usd: 0,
    ask_usd: 0,
    bid_usd_adj: 0,
    ask_usd_adj: 0,
    dayHigh: 0,
    dayLow: 0,
    prevClose: 0,
    status: '',
    nextOpenTime: null,
    updatedAt: null,
  },
  okx: {
    last: 0,
    bid: 0,
    ask: 0,
    fundingRate: 0,
    nextFundingTime: null,
    updatedAt: null,
  },
  fx: {
    krwUsd: 0,
    source: '',
    updatedAt: null,
  },
  signal: {
    type: 'wait',
    entrySpread: 0,
    exitSpread: 0,
    message: '等待數據...',
    dataDelayWarning: false,
  },
  marketOpen: false,
};

let fxCache = { rate: 0, timestamp: 0, source: '' };

async function fetchKRWUSD() {
  const now = Date.now();
  if (fxCache.rate && (now - fxCache.timestamp) < CONFIG.FX_CACHE_TTL) {
    return fxCache;
  }
  // Primary: hourly-updated API
  try {
    const res = await fetch('https://api.exchangerate.fun/latest?base=KRW', {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const data = await res.json();
    if (data && data.rates && data.rates.USD) {
      fxCache = { rate: data.rates.USD, timestamp: now, source: 'exchangerate.fun (每小時更新)' };
      console.log(`[FX] KRW/USD = ${data.rates.USD} (from exchangerate.fun, hourly)`);
      return fxCache;
    }
  } catch (err) {
    console.error('[FX] Primary API failed:', err.message);
  }
  // Fallback: daily API
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/KRW');
    const data = await res.json();
    if (data.result === 'success' && data.rates.USD) {
      fxCache = { rate: data.rates.USD, timestamp: now, source: 'open.er-api.com (每日更新)' };
      console.log(`[FX] KRW/USD = ${data.rates.USD} (from open.er-api.com, daily)`);
      return fxCache;
    }
  } catch (err) {
    console.error('[FX] Fallback API failed:', err.message);
  }
  return fxCache;
}

async function fetchGateStock() {
  try {
    const data = await gateScraper.scrapeBidAsk();
    if (!data || !data.bid || !data.ask) {
      console.error('[Gate] Scraper returned no data');
      return;
    }

    const bidKrw = data.bid;
    const askKrw = data.ask;
    const price = data.price || ((bidKrw + askKrw) / 2);
    const dayHigh = data.dayHigh || 0;
    const dayLow = data.dayLow || 0;
    const prevClose = data.prevClose || 0;

    const fxInfo = await fetchKRWUSD();
    const krwUsd = fxInfo.rate;

    const priceUsd = price * krwUsd;
    const bidUsd = bidKrw * krwUsd;
    const askUsd = askKrw * krwUsd;

    state.gate = {
      price_krw: price,
      bid_krw: bidKrw,
      ask_krw: askKrw,
      price_usd: Math.round(priceUsd * 100) / 100,
      bid_usd: Math.round(bidUsd * 100) / 100,
      ask_usd: Math.round(askUsd * 100) / 100,
      bid_usd_adj: Math.round((bidUsd - CONFIG.SLIPPAGE_BID) * 100) / 100,
      ask_usd_adj: Math.round((askUsd + CONFIG.SLIPPAGE_ASK) * 100) / 100,
      dayHigh,
      dayLow,
      prevClose,
      updatedAt: new Date(),
    };

    state.fx = { krwUsd, source: fxInfo.source, updatedAt: new Date() };

    console.log(`[Gate] ₩${price.toLocaleString()} | $${state.gate.price_usd} | Bid: ₩${bidKrw.toLocaleString()} | Ask: ₩${askKrw.toLocaleString()}`);
  } catch (err) {
    console.error('[Gate] Error:', err.message);
  }
}

async function fetchOKX() {
  try {
    const tickerRes = await fetch(
      `https://www.okx.com/api/v5/market/ticker?instId=${CONFIG.OKX_INST_ID}`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    const tickerData = await tickerRes.json();
    const t = tickerData?.data?.[0];
    if (!t) return;

    const frRes = await fetch(
      `https://www.okx.com/api/v5/public/funding-rate?instId=${CONFIG.OKX_INST_ID}`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    const frData = await frRes.json();
    const fr = frData?.data?.[0];

    state.okx = {
      last: parseFloat(t.last),
      bid: parseFloat(t.bidPx),
      ask: parseFloat(t.askPx),
      high24h: parseFloat(t.high24h) || 0,
      low24h: parseFloat(t.low24h) || 0,
      fundingRate: fr ? parseFloat(fr.fundingRate) : 0,
      nextFundingTime: fr ? parseInt(fr.nextFundingTime) : null,
      updatedAt: new Date(),
    };

    console.log(`[OKX] $${state.okx.last} | B: $${state.okx.bid} | A: $${state.okx.ask} | FR: ${(state.okx.fundingRate * 100).toFixed(4)}%`);
  } catch (err) {
    console.error('[OKX] Error:', err.message);
  }
}

function calculateSignal() {
  const { gate, okx } = state;

  if (!gate.ask_usd_adj || !okx.bid || !gate.bid_usd_adj || !okx.ask) {
    state.signal = { type: 'wait', entrySpread: 0, exitSpread: 0, message: '等待數據...', dataDelayWarning: false };
    return;
  }

  const entrySpread = gate.ask_usd_adj - okx.bid;
  const exitSpread = gate.bid_usd_adj - okx.ask;

  let type = 'wait';
  let message = '';

  if (entrySpread < 0) {
    type = 'enter';
    message = `進場: Gate Ask $${gate.ask_usd_adj} < OKX Bid $${okx.bid} (差: $${Math.abs(entrySpread).toFixed(2)})`;
  } else if (exitSpread > 0) {
    type = 'exit';
    message = `出場: Gate Bid $${gate.bid_usd_adj} > OKX Ask $${okx.ask} (差: $${exitSpread.toFixed(2)})`;
  } else {
    message = `無訊號 (價差不在進出場範圍)`;
  }

  state.signal = {
    type,
    entrySpread,
    exitSpread,
    message,
    dataDelayWarning: false,
  };
}

function broadcast() {
  io.emit('update', {
    gate: state.gate,
    okx: state.okx,
    fx: state.fx,
    signal: state.signal,
    marketOpen: state.marketOpen,
    timestamp: Date.now(),
  });
}

async function poll() {
  await Promise.all([fetchGateStock(), fetchOKX()]);
  calculateSignal();
  broadcast();
}

server.listen(PORT, async () => {
  console.log(`\n======================================`);
  console.log(`  SK Hynix Arbitrage Monitor v3`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`======================================\n`);
  await gateScraper.init();
  poll();
  setInterval(poll, CONFIG.POLL_INTERVAL);
});

io.on('connection', (socket) => {
  socket.emit('update', {
    gate: state.gate,
    okx: state.okx,
    fx: state.fx,
    signal: state.signal,
    marketOpen: state.marketOpen,
    timestamp: Date.now(),
  });
});
