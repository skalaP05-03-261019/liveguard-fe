// Reproducible frontend-only probe. Mutates the reactive mock feed in a production
// preview; it does not exercise SSE, Backend, Agent, or network throughput.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const output = process.env.PERF_OUTPUT || path.resolve(__dirname, '../docs/evidence/performance/frontend-smoke.json');
const phases = [{ name: '10-per-second', rate: 10, count: 100 }, { name: '100-per-second', rate: 100, count: 1000 }];
const percentile = (values, fraction) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return +sorted[Math.ceil(sorted.length * fraction) - 1].toFixed(2);
};

(async () => {
  const { preview } = await import('vite');
  const server = await preview({ preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  const address = server.httpServer.address();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  const heap = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    const metrics = (await cdp.send('Performance.getMetrics')).metrics;
    return Math.round((metrics.find(item => item.name === 'JSHeapUsedSize')?.value || 0) / 1024 / 1024 * 100) / 100;
  };
  const results = [];
  try {
    await page.goto(`http://127.0.0.1:${address.port}`);
    await page.getByRole('button', { name: '스트리머로 시작하기', exact: true }).click();
    await page.getByRole('button', { name: '로그인', exact: true }).click();
    await page.locator('.studio-shell .chat-list').waitFor();
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('liveGuard');
      if (!store) throw new Error('Mock Pinia store unavailable');
      if (store.feedOn) store.toggleFeed();
      window.__perfStore = store;
      window.__perf = { sentAt: new Map(), seenAt: new Map(), raf: [], longTasks: [] };
      const list = document.querySelector('.studio-shell .chat-list');
      new MutationObserver(mutations => {
        for (const mutation of mutations) for (const node of mutation.addedNodes) {
          if (!(node instanceof Element)) continue;
          const rows = node.matches('.chat-row[data-message-id]') ? [node] : [...node.querySelectorAll('.chat-row[data-message-id]')];
          for (const row of rows) if (row.dataset.messageId?.startsWith('perf-')) window.__perf.seenAt.set(row.dataset.messageId, performance.now());
        }
      }).observe(list, { childList: true, subtree: true });
      try { new PerformanceObserver(list => window.__perf.longTasks.push(...list.getEntries().map(e => e.duration))).observe({ entryTypes: ['longtask'] }); } catch {}
    });
    for (const phase of phases) {
      const before = await heap();
      const run = await page.evaluate(async ({ name, rate, count }) => {
        const perf = window.__perf, store = window.__perfStore;
        let active = true, lastFrame = performance.now();
        const frame = now => { if (!active) return; perf.raf.push(now - lastFrame); lastFrame = now; requestAnimationFrame(frame); };
        requestAnimationFrame(frame);
        const started = performance.now();
        let sent = 0;
        await new Promise(resolve => {
          const timer = setInterval(() => {
            const expected = Math.min(count, Math.floor((performance.now() - started) * rate / 1000));
            while (sent < expected) {
              const id = `perf-${name}-${sent++}`;
              perf.sentAt.set(id, performance.now());
              store.mock.state.messages.push({ messageId: id, channelId: store.mock.state.live.channelId,
                liveId: store.mock.state.live.liveId, authorAlias: '성능 시험', ownerId: 'perf-viewer',
                text: `성능 시험 메시지 ${sent}`, visibility: 'PUBLIC', version: 1,
                sentAt: new Date().toISOString(), isMine: false });
            }
            if (sent === count) { clearInterval(timer); resolve(); }
          }, 1);
        });
        const emissionMs = performance.now() - started;
        const end = performance.now() + 3000;
        while (performance.now() < end && [...perf.sentAt.keys()].filter(id => id.startsWith(`perf-${name}-`) && perf.seenAt.has(id)).length < count)
          await new Promise(resolve => setTimeout(resolve, 20));
        active = false;
        return { emissionMs, sent };
      }, phase);
      const after = await heap();
      const data = await page.evaluate(name => {
        const p = window.__perf, prefix = `perf-${name}-`;
        const ids = [...p.sentAt.keys()].filter(id => id.startsWith(prefix));
        return { ids, latencies: ids.filter(id => p.seenAt.has(id)).map(id => p.seenAt.get(id) - p.sentAt.get(id)),
          frameGaps: p.raf.splice(0), longTasks: p.longTasks.splice(0), domRows: document.querySelectorAll('.studio-shell .chat-list .chat-row').length };
      }, phase.name);
      results.push({ phase: phase.name, targetRate: phase.rate, targetCount: phase.count,
        actualRate: +(run.sent / run.emissionMs * 1000).toFixed(2), emitted: run.sent,
        observed: data.latencies.length, missing: run.sent - data.latencies.length,
        domLatencyMs: { p50: percentile(data.latencies, .5), p95: percentile(data.latencies, .95), max: percentile(data.latencies, 1) },
        frameGapMs: { p95: percentile(data.frameGaps, .95), max: percentile(data.frameGaps, 1) },
        longTasksOver50ms: data.longTasks.filter(value => value >= 50).length,
        domRows: data.domRows, heapMbAfterGc: { before, after } });
    }
    const status = await page.evaluate(async () => {
      const store = window.__perfStore;
      const targets = store.mock.state.messages.slice(-200);
      const started = performance.now();
      for (const message of targets) { message.visibility = 'HELD'; message.version++; }
      await new Promise(resolve => requestAnimationFrame(() => resolve()));
      return { changed: targets.length, domHeld: document.querySelectorAll('.studio-shell .chat-list .chat-row.held').length,
        elapsedMs: +(performance.now() - started).toFixed(2) };
    });
    const result = { measuredAt: new Date().toISOString(), scope: 'production preview, mock reactive feed, one Chromium run',
      viewport: '1440x900', browser: browser.version(), phases: results, statusChange: status, pageErrors: errors };
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result));
    if (errors.length || results.some(row => row.missing > 0) || status.domHeld !== status.changed) process.exitCode = 1;
  } finally { await browser.close(); await server.httpServer.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
