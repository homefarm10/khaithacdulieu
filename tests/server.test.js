const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createApp, PythonBridge } = require('../server');

async function start(t, options) {
  const { app, bridge } = createApp(options);
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  t.after(async () => { bridge.close(); await new Promise((resolve) => server.close(resolve)); });
  const url = `http://127.0.0.1:${server.address().port}`;
  async function request(route, method = 'GET') {
    const response = await fetch(url + route, { method });
    return { status: response.status, body: await response.json() };
  }
  return { request, url, bridge };
}

test('static interface and API validation', async (t) => {
  const { request, url } = await start(t);
  const page = await fetch(url);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Phân cụm khách hàng/);
  assert.equal((await fetch(url + '/data.csv')).status, 404);
  for (const query of ['page=0', 'page=-1', 'page=1.2', 'page=abc', 'page=1&page=2', 'table=other']) {
    assert.equal((await request('/api/table?' + query)).status, 400);
  }
  assert.equal((await request('/api/unknown')).status, 404);
});

test('wrong sequence, missing file, retry, concurrent request and worker recovery', async (t) => {
  const { request, bridge } = await start(t, { dataPath: path.join(__dirname, 'missing.csv') });
  assert.equal((await request('/api/cluster', 'POST')).status, 409);
  assert.equal((await request('/api/table')).status, 500);
  assert.equal((await request('/api/table')).status, 500);
  // Occupied bridge must reject another task immediately, without queuing it.
  const first = bridge.request({ action: 'table' });
  await assert.rejects(bridge.request({ action: 'process' }), { status: 409 });
  await assert.rejects(first, /Không tìm thấy/);
  const interrupted = bridge.request({ action: 'table' });
  bridge.child.kill();
  await assert.rejects(interrupted, /đã dừng|Mất kết nối/);
  assert.equal((await request('/api/cluster', 'POST')).status, 409);
});

test('missing Python executable returns actionable error', async (t) => {
  const { request } = await start(t, { python: 'python-executable-does-not-exist' });
  const result = await request('/api/table');
  assert.equal(result.status, 500);
  assert.match(result.body.error, /Không khởi động được Python/);
});

test('worker timeout ends the session and clears the request lock', async (t) => {
  const bridge = new PythonBridge({ timeout: 1 });
  t.after(() => bridge.close());
  await assert.rejects(bridge.request({ action: 'table' }), { status: 504 });
  assert.equal(bridge.child, null);
  assert.equal(bridge.pending, null);
});
