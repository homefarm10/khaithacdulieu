// Full integration check on the actual project CSV; no output CSV is written.
const assert = require('node:assert/strict');
const { createApp } = require('../server');

(async () => {
  const { app, bridge } = createApp();
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(route, method = 'GET') {
    const response = await fetch(base + route, { method });
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    return result;
  }
  try {
    const raw = await request('/api/table');
    assert.equal(raw.columns.length, 8);
    assert.equal(raw.rows.length, 50);
    const last = await request(`/api/table?page=${raw.totalPages}`);
    assert.equal((raw.totalPages - 1) * 50 + last.rows.length, raw.total);
    await request('/api/process', 'POST');
    const processed = await request('/api/table?table=processed');
    assert.equal(processed.columns.length, 9);
    const meta = await request('/api/cluster', 'POST');
    const clustered = await request('/api/table?table=clustered');
    assert.equal(clustered.total, processed.total);
    assert.deepEqual(clustered.columns, [...processed.columns, 'FCM_Label']);
    assert.deepEqual(clustered.rows.map((row) => row.slice(0, -1)), processed.rows);
    for (const row of clustered.rows) assert.ok(Number.isInteger(row.at(-1)) && row.at(-1) >= 0 && row.at(-1) < meta.clusterCount);
    assert.deepEqual((await request('/api/table')).rows, raw.rows);
    assert.deepEqual((await request('/api/table?table=processed')).rows, processed.rows);
    console.log(`PASS: ${raw.total} giao dịch → ${processed.total} khách hàng → ${meta.clusterCount} cụm FCM. Chuyển ba bảng thành công.`);
  } finally {
    bridge.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
