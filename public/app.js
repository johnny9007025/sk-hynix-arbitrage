const socket = io();
const MAX_HISTORY = 80;
let priceHistory = [];
let priceChart = null;
let spreadChart = null;

Chart.defaults.color = '#6a6a8a';
Chart.defaults.font.family = "'JetBrains Mono','Courier New',monospace";

function initCharts() {
  const priceCtx = document.getElementById('priceChart').getContext('2d');
  priceChart = new Chart(priceCtx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Gate (USD)',
          data: [],
          borderColor: '#4ade80',
          backgroundColor: (ctx) => {
            if (!ctx.chart.chartArea) return;
            const g = ctx.chart.chartArea;
            const grad = ctx.chart.ctx.createLinearGradient(0, g.top, 0, g.bottom);
            grad.addColorStop(0, 'rgba(74,222,128,0.25)');
            grad.addColorStop(1, 'rgba(74,222,128,0)');
            return grad;
          },
          fill: true,
          borderWidth: 2,
          tension: 0.3,
          pointRadius: 0,
        },
        {
          label: 'OKX (USDT)',
          data: [],
          borderColor: '#60a5fa',
          backgroundColor: (ctx) => {
            if (!ctx.chart.chartArea) return;
            const g = ctx.chart.chartArea;
            const grad = ctx.chart.ctx.createLinearGradient(0, g.top, 0, g.bottom);
            grad.addColorStop(0, 'rgba(96,165,250,0.25)');
            grad.addColorStop(1, 'rgba(96,165,250,0)');
            return grad;
          },
          fill: true,
          borderWidth: 2,
          tension: 0.3,
          pointRadius: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 200 },
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: {
          position: 'top',
          labels: { color: '#6a6a8a', font: { size: 10, family: 'Inter' }, boxWidth: 14, padding: 8 },
        },
      },
      scales: {
        x: {
          ticks: { color: '#444466', maxTicksLimit: 6, font: { size: 9 } },
          grid: { color: 'rgba(255,255,255,0.03)' },
        },
        y: {
          ticks: { color: '#444466', font: { size: 9 } },
          grid: { color: 'rgba(255,255,255,0.03)' },
        },
      },
    },
  });

  const spreadCtx = document.getElementById('spreadChart').getContext('2d');
  spreadChart = new Chart(spreadCtx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: '進場價差',
          data: [],
          borderColor: '#4ade80',
          borderWidth: 1.5,
          tension: 0.3,
          pointRadius: 0,
        },
        {
          label: '出場價差',
          data: [],
          borderColor: '#f87171',
          borderWidth: 1.5,
          tension: 0.3,
          pointRadius: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 200 },
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: {
          position: 'top',
          labels: { color: '#6a6a8a', font: { size: 10, family: 'Inter' }, boxWidth: 14, padding: 8 },
        },
      },
      scales: {
        x: {
          ticks: { color: '#444466', maxTicksLimit: 4, font: { size: 9 } },
          grid: { color: 'rgba(255,255,255,0.03)' },
        },
        y: {
          ticks: { color: '#444466', font: { size: 9 } },
          grid: { color: 'rgba(255,255,255,0.03)' },
        },
      },
    },
  });
}

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('zh-TW', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fmtUsd(n) {
  if (n == null || n === 0) return '--';
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtKrw(n) {
  if (!n) return '--';
  return Number(n).toLocaleString('ko-KR') + ' ₩';
}

function updateUI(data) {
  const { gate, okx, fx, signal, timestamp } = data;

  // Status
  document.getElementById('marketStatus').textContent = '● Gate 24h 交易中';
  document.getElementById('marketStatus').className = 'badge open';

  // Funding rate
  const frEl = document.getElementById('fundingRate');
  if (okx.fundingRate != null) {
    const pct = (okx.fundingRate * 100).toFixed(4);
    frEl.textContent = `資金費率: ${pct}%`;
    frEl.style.color = okx.fundingRate > 0 ? '#f87171' : '#4ade80';
  }

  document.getElementById('lastUpdate').textContent = fmtTime(timestamp);

  // Gate
  document.getElementById('gatePriceKrw').textContent = fmtKrw(gate.price_krw);
  document.getElementById('gatePriceUsd').textContent = fmtUsd(gate.price_usd);
  document.getElementById('gateBidAskKrw').textContent = fmtKrw(gate.bid_krw) + ' / ' + fmtKrw(gate.ask_krw);
  document.getElementById('gateBidAskUsd').textContent = fmtUsd(gate.bid_usd) + ' / ' + fmtUsd(gate.ask_usd);
  document.getElementById('gateBidAdj').textContent = fmtUsd(gate.bid_usd_adj);
  document.getElementById('gateAskAdj').textContent = fmtUsd(gate.ask_usd_adj);
  document.getElementById('gateDayRange').textContent = (gate.dayLow ? fmtKrw(gate.dayLow) : '--') + ' ~ ' + (gate.dayHigh ? fmtKrw(gate.dayHigh) : '--') + ' / 昨收 ' + (gate.prevClose ? fmtKrw(gate.prevClose) : '--');

  // OKX
  document.getElementById('okxLast').textContent = fmtUsd(okx.last);
  document.getElementById('okxBidAsk').textContent = fmtUsd(okx.bid) + ' / ' + fmtUsd(okx.ask);
  document.getElementById('okxFr').textContent = okx.fundingRate != null ? (okx.fundingRate * 100).toFixed(4) + '%' : '--';
  const nextFr = okx.nextFundingTime ? new Date(okx.nextFundingTime) : null;
  document.getElementById('okxNextFr').textContent = nextFr ? fmtTime(nextFr.getTime()) : '--';
  document.getElementById('okxRange').textContent = okx.low24h && okx.high24h ? fmtUsd(okx.low24h) + ' ~ ' + fmtUsd(okx.high24h) : '--';

  // Signal
  const indicator = document.getElementById('signalIndicator');
  const typeEl = document.getElementById('signalType');
  const msgEl = document.getElementById('signalMessage');
  const gaugeFill = document.getElementById('spreadGaugeFill');

  indicator.className = 'signal-indicator ' + signal.type;
  gaugeFill.className = 'spread-gauge-fill ' + signal.type;

  if (signal.type === 'enter') {
    indicator.textContent = '▲';
    typeEl.textContent = '進場訊號';
    typeEl.style.color = '#4ade80';
  } else if (signal.type === 'exit') {
    indicator.textContent = '▼';
    typeEl.textContent = '出場訊號';
    typeEl.style.color = '#f87171';
  } else {
    indicator.textContent = '●';
    typeEl.textContent = '等待中';
    typeEl.style.color = '#8888aa';
  }
  msgEl.textContent = signal.message || '--';

  // Spread values
  const entryEl = document.getElementById('entrySpread');
  const exitEl = document.getElementById('exitSpread');
  if (signal.entrySpread != null) {
    const v = Math.abs(signal.entrySpread);
    entryEl.textContent = signal.entrySpread !== 0 ? fmtUsd(v) : '--';
    entryEl.className = 'spread-value ' + (signal.entrySpread < 0 ? 'negative' : signal.entrySpread > 0 ? 'positive' : '');
  }
  if (signal.exitSpread != null) {
    const v = Math.abs(signal.exitSpread);
    exitEl.textContent = signal.exitSpread !== 0 ? fmtUsd(v) : '--';
    exitEl.className = 'spread-value ' + (signal.exitSpread > 0 ? 'negative' : signal.exitSpread < 0 ? 'positive' : '');
  }

  // Spread gauge
  const maxSpread = 100;
  if (signal.type === 'enter') {
    const pct = Math.min(Math.abs(signal.entrySpread) / maxSpread * 50, 50);
    gaugeFill.style.width = (50 + pct) + '%';
    gaugeFill.style.background = 'linear-gradient(90deg, #4ade80, #22d3ee)';
    gaugeFill.style.left = (50 - pct) + '%';
  } else if (signal.type === 'exit') {
    const pct = Math.min(Math.abs(signal.exitSpread) / maxSpread * 50, 50);
    gaugeFill.style.width = pct + '%';
    gaugeFill.style.background = 'linear-gradient(90deg, #f87171, #fb923c)';
    gaugeFill.style.left = '50%';
  } else {
    gaugeFill.style.width = '4px';
    gaugeFill.style.left = '50%';
    gaugeFill.style.background = '#6a6a8a';
  }

  // FX & source
  document.getElementById('fxInfo').textContent = fx.source
    ? `匯率: $${(fx.krwUsd || 0).toFixed(7)}`
    : '匯率: --';
  document.getElementById('dataSource').textContent = 'Gate: Puppeteer';

  // Price history
  if (gate.price_usd && okx.last) {
    priceHistory.push({
      time: timestamp,
      gate: gate.price_usd,
      okx: okx.last,
      entry: signal.entrySpread,
      exit: signal.exitSpread,
    });
    if (priceHistory.length > MAX_HISTORY) priceHistory = priceHistory.slice(-MAX_HISTORY);
    updateCharts();
  }
}

function updateCharts() {
  if (!priceChart || !spreadChart) return;

  const labels = priceHistory.map((p) => fmtTime(p.time));

  priceChart.data.labels = labels;
  priceChart.data.datasets[0].data = priceHistory.map((p) => p.gate);
  priceChart.data.datasets[1].data = priceHistory.map((p) => p.okx);
  priceChart.update('none');

  spreadChart.data.labels = labels;
  spreadChart.data.datasets[0].data = priceHistory.map((p) => p.entry);
  spreadChart.data.datasets[1].data = priceHistory.map((p) => p.exit);
  spreadChart.update('none');
}

initCharts();

socket.on('update', (data) => updateUI(data));
socket.on('connect', () => console.log('Connected'));
socket.on('disconnect', () => console.log('Disconnected'));
