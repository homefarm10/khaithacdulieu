const express = require('express');
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const path = require('node:path');

class ApiError extends Error {
  constructor(message, status = 500) { super(message); this.status = status; }
}

class PythonBridge {
  constructor({ python = process.env.PYTHON || 'python', dataPath = path.join(__dirname, 'data.csv'), timeout = 300000 } = {}) {
    this.python = python;
    this.dataPath = dataPath;
    this.timeout = timeout;
    this.sequence = 0;
    this.child = null;
    this.pending = null;
  }

  start() {
    const child = spawn(this.python, ['-u', path.join(__dirname, 'worker.py'), this.dataPath], {
      cwd: __dirname, shell: false, windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', MPLBACKEND: 'Agg' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    const fail = (message) => {
      if (this.child !== child) return;
      this.child = null;
      this.rejectPending(new ApiError(message));
    };
    child.on('error', () => fail('Không khởi động được Python. Kiểm tra cài đặt Python hoặc biến PYTHON.'));
    child.on('exit', () => fail('Tiến trình Python đã dừng. Kiểm tra thư viện Python và log server; thử lại để bắt đầu phiên mới.'));
    child.stdin.on('error', () => fail('Mất kết nối với Python. Thử lại để bắt đầu phiên mới.'));
    child.stderr.on('data', (chunk) => process.stderr.write(chunk));
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      if (this.child !== child) return;
      try {
        const message = JSON.parse(line);
        if (!this.pending || this.pending.id !== message.id) return;
        const pending = this.pending;
        this.pending = null;
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new ApiError(message.error, message.status));
        else pending.resolve(message.data);
      } catch {
        fail('Python trả dữ liệu không hợp lệ. Thử lại để bắt đầu phiên mới.');
        child.kill();
      }
    });
  }

  rejectPending(error) {
    if (!this.pending) return;
    clearTimeout(this.pending.timer);
    this.pending.reject(error);
    this.pending = null;
  }

  request(payload) {
    if (this.pending) return Promise.reject(new ApiError('Một tác vụ đang chạy. Vui lòng chờ hoàn tất.', 409));
    if (!this.child) this.start();
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.close(new ApiError('Xử lý vượt quá 5 phút. Kiểm tra dữ liệu và thử lại; phiên dữ liệu đã được đặt lại.', 504));
      }, this.timeout);
      this.pending = { id, resolve, reject, timer };
      this.child.stdin.write(`${JSON.stringify({ ...payload, id })}\n`);
    });
  }

  close(error = new ApiError('Server đã dừng.')) {
    const child = this.child;
    this.child = null;
    this.rejectPending(error);
    if (child) child.kill();
  }
}

function createApp(options = {}) {
  const app = express();
  const bridge = new PythonBridge(options);
  app.disable('x-powered-by');
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.get('/api/table', async (req, res) => {
    const pageText = req.query.page ?? '1';
    const table = req.query.table ?? 'raw';
    if (typeof pageText !== 'string' || !/^[1-9]\d*$/.test(pageText) || !Number.isSafeInteger(Number(pageText))) {
      throw new ApiError('Số trang phải là số nguyên dương.', 400);
    }
    if (!['raw', 'processed', 'clustered'].includes(table)) throw new ApiError('Bảng dữ liệu không hợp lệ.', 400);
    res.json(await bridge.request({ action: 'table', table, page: Number(pageText) }));
  });
  app.post('/api/process', async (_req, res) => res.json(await bridge.request({ action: 'process' })));
  app.post('/api/cluster', async (_req, res) => res.json(await bridge.request({ action: 'cluster' })));
  app.use('/api', (_req, _res, next) => next(new ApiError('API không tồn tại.', 404)));
  app.use(express.static(path.join(__dirname, 'public')));
  app.use((error, _req, res, _next) => {
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Lỗi server. Xem log để biết chi tiết.' });
  });
  return { app, bridge };
}

if (require.main === module) {
  const { app, bridge } = createApp();
  const server = app.listen(3000, '127.0.0.1', () => console.log('Mở giao diện tại http://localhost:3000'));
  server.on('error', (error) => {
    console.error(error.code === 'EADDRINUSE' ? 'Cổng 3000 đang được sử dụng. Hãy dừng ứng dụng đang chiếm cổng rồi chạy lại.' : error.message);
    bridge.close();
    process.exitCode = 1;
  });
  const shutdown = () => { bridge.close(); server.close(); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = { createApp, PythonBridge };
