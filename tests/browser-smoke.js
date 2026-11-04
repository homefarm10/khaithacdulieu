// Optional UI check using an existing Chrome/Edge installation (no browser download).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createApp } = require('../server');

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error('Browser WebSocket connection timed out.')); }, 10000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', (error) => { clearTimeout(timer); reject(error); }, { once: true });
  });
  let sequence = 0;
  const pending = new Map();
  const errors = [];
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    const handler = pending.get(message.id);
    if (!handler) return;
    clearTimeout(handler.timer);
    pending.delete(message.id);
    if (message.error) handler.reject(new Error(JSON.stringify(message.error)));
    else handler.resolve(message.result);
  });
  return {
    errors,
    close: () => socket.close(),
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 20000);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
  };
}

(async () => {
  const executable = [process.env.BROWSER_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((candidate) => candidate && fs.existsSync(candidate));
  assert.ok(executable, 'Cần Chrome/Edge hoặc BROWSER_PATH để chạy kiểm tra giao diện.');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'customer-lab-browser-'));
  const { app, bridge } = createApp();
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  let browser;
  let cdp;
  let browserConnection;
  try {
    browser = spawn(executable, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    const endpoint = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Browser startup timed out.')), 20000);
      let stderr = '';
      browser.on('error', (error) => { clearTimeout(timer); reject(error); });
      browser.on('exit', (code) => { clearTimeout(timer); reject(new Error(`Browser exited: ${code}. ${stderr.slice(-1000)}`)); });
      browser.stderr.on('data', (chunk) => {
        stderr += chunk;
        const match = stderr.match(/DevTools listening on (ws:\/\/\S+)/);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
    });
    browserConnection = await connect(endpoint);
    const host = new URL(endpoint).host;
    const target = await (await fetch(`http://${host}/json/new?about:blank`, { method: 'PUT' })).json();
    cdp = await connect(target.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1050, deviceScaleFactor: 1, mobile: false });
    async function evaluate(expression) {
      const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    }
    async function waitFor(expression) {
      for (let i = 0; i < 150; i++) {
        if (await evaluate(expression)) return;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      throw new Error(`UI wait timed out: ${expression}`);
    }
    const idle = "document.getElementById('status').hidden && document.getElementById('error').hidden";
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}` });
    await waitFor(`document.querySelectorAll('#table-body tr').length === 50 && ${idle}`);
    assert.equal(await evaluate("document.querySelectorAll('#table-head th').length"), 9);
    await evaluate("document.getElementById('next').click()");
    await waitFor(`document.getElementById('page-input').value === '2' && ${idle}`);
    assert.equal(await evaluate("document.querySelector('#table-body td').textContent"), '51');
    await evaluate("document.getElementById('process-button').click()");
    await waitFor(`document.querySelector('.tab.active').dataset.table === 'processed' && ${idle}`);
    assert.equal(await evaluate("document.querySelectorAll('#table-head th').length"), 10);
    await evaluate("document.getElementById('cluster-button').click()");
    await waitFor(`document.querySelector('.tab.active').dataset.table === 'clustered' && ${idle}`);
    assert.equal(await evaluate("document.querySelector('#table-head th:last-child').textContent"), 'FCM_Label');
    assert.equal(await evaluate("document.querySelectorAll('.label-cell').length"), 50);
    for (const table of ['raw', 'processed', 'clustered']) {
      await evaluate(`document.querySelector('[data-table="${table}"]').click()`);
      await waitFor(`document.querySelector('.tab.active').dataset.table === '${table}' && ${idle}`);
    }
    const output = path.join(__dirname, '..', '.preview');
    fs.mkdirSync(output, { recursive: true });
    async function screenshot(name) {
      const result = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(path.join(output, name), Buffer.from(result.data, 'base64'));
    }
    await screenshot('desktop.png');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    assert.ok(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'Trang mobile không được tràn ngang.');
    await screenshot('mobile.png');
    assert.deepEqual(cdp.errors, [], 'Không có lỗi JavaScript trên trình duyệt.');
    console.log('PASS: Browser desktop/mobile, phân trang, xử lý RFM, FCM và chuyển ba bảng. Ảnh kiểm tra: .preview/');
  } finally {
    if (cdp) cdp.close();
    if (browserConnection) {
      await browserConnection.send('Browser.close').catch(() => {});
      browserConnection.close();
    }
    if (browser && browser.exitCode === null) browser.kill();
    bridge.close();
    await new Promise((resolve) => server.close(resolve));
    // Only remove the unique temporary browser profile created by this script.
    if (path.dirname(profile) === os.tmpdir() && path.basename(profile).startsWith('customer-lab-browser-')) {
      try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* Browser may still be releasing files. */ }
    }
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
