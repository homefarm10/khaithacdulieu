const $ = (id) => document.getElementById(id);
const format = new Intl.NumberFormat('vi-VN');
const views = {
  raw: { title: 'Dữ liệu giao dịch', kicker: 'DỮ LIỆU ĐẦU VÀO', description: 'Toàn bộ dữ liệu ban đầu, giữ nguyên các cột và giá trị từ file CSV.', note: 'Bắt đầu với dữ liệu gốc. Nhấn “Phân cụm khách hàng” để làm sạch và tính các chỉ số RFM.' },
  processed: { title: 'Hồ sơ RFM khách hàng', kicker: 'DỮ LIỆU SAU XỬ LÝ', description: 'Mỗi dòng là một khách hàng với chỉ số RFM, điểm số và nhóm Segment.', note: 'Segment được gán theo quy tắc RFM. Nhấn “Phân cụm bằng FCM” để tạo nhãn cụm cho từng khách hàng.' },
  clustered: { title: 'Kết quả phân cụm FCM', kicker: 'PHÂN CỤM HOÀN TẤT', description: 'Bảng RFM được bổ sung cột FCM_Label từ kết quả phân cụm.', note: 'FCM_Label là nhãn số bắt đầu từ 0 do FCM trả về. Segment là nhóm theo quy tắc RFM, được giữ nguyên.' },
};
let current = 'raw';
let page = 1;
let totalPages = 1;
let available = [];
let busy = false;
let retryAction = null;

async function api(url, method = 'GET') {
  const response = await fetch(url, { method });
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.error || 'Không thể thực hiện yêu cầu.');
    error.status = response.status;
    throw error;
  }
  return result;
}

function controls() {
  $('process-button').disabled = busy;
  $('cluster-button').hidden = !available.includes('processed');
  $('cluster-button').disabled = busy || !available.includes('processed');
  document.querySelectorAll('[data-table]').forEach((button) => {
    button.disabled = busy || (button.dataset.table !== 'raw' && !available.includes(button.dataset.table));
    const active = button.dataset.table === current;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  document.querySelectorAll('[data-step]').forEach((step) => {
    const name = step.dataset.step;
    step.classList.toggle('current', name === current);
    step.querySelector('.step-state').textContent = name === current ? 'Đang xem' : available.includes(name) ? 'Hoàn tất' : 'Chưa chạy';
  });
  $('previous').disabled = busy || page <= 1;
  $('next').disabled = busy || page >= totalPages;
  $('page-input').disabled = busy || !available.includes(current);
  $('retry-button').disabled = busy;
}

async function run(task, message, retry) {
  if (busy) return;
  busy = true;
  $('error').hidden = true;
  $('status').hidden = false;
  $('status-text').textContent = message;
  $('table-region').setAttribute('aria-busy', 'true');
  controls();
  try {
    await task();
    retryAction = null;
  } catch (error) {
    $('error-text').textContent = error.message === 'Failed to fetch' ? 'Mất kết nối với server. Kiểm tra cửa sổ đang chạy npm start rồi thử lại.' : error.message;
    $('error').hidden = false;
    // A failed worker loses its in-memory tables; reload raw before another job.
    if (!error.status || error.status >= 500) {
      available = [];
      retryAction = () => load('raw', 1);
    } else retryAction = retry;
  } finally {
    busy = false;
    $('status').hidden = true;
    $('table-region').setAttribute('aria-busy', 'false');
    controls();
  }
}

function render(data) {
  current = data.table;
  page = data.page;
  totalPages = data.totalPages;
  available = data.available;
  const view = views[current];
  $('table-title').textContent = view.title;
  $('table-caption').textContent = view.title;
  $('table-kicker').textContent = view.kicker;
  $('table-description').textContent = view.description;
  $('note-text').textContent = view.note + (current === 'clustered' ? ` Số cụm: ${data.clusterCount}; m = 1.5.` : '');
  $('table-head').replaceChildren();
  $('table-body').replaceChildren();
  const header = document.createElement('tr');
  ['STT', ...data.columns].forEach((column) => {
    const cell = document.createElement('th');
    cell.scope = 'col';
    cell.textContent = column;
    header.append(cell);
  });
  $('table-head').append(header);
  const rows = document.createDocumentFragment();
  data.rows.forEach((row, index) => {
    const tr = document.createElement('tr');
    const ordinal = document.createElement('td');
    ordinal.textContent = format.format((page - 1) * data.pageSize + index + 1);
    tr.append(ordinal);
    row.forEach((value, column) => {
      const cell = document.createElement('td');
      cell.textContent = value == null ? '' : String(value);
      if (value == null || value === '') cell.className = 'missing';
      if (data.columns[column] === 'FCM_Label') cell.className = 'label-cell';
      tr.append(cell);
    });
    rows.append(tr);
  });
  $('table-body').append(rows);
  $('empty').hidden = data.total !== 0;
  $('row-count').textContent = `${format.format(data.total)} ${current === 'raw' ? 'giao dịch' : 'khách hàng'} · ${data.columns.length} cột`;
  $('range').textContent = data.total ? `${format.format((page - 1) * 50 + 1)}–${format.format(Math.min(page * 50, data.total))} / ${format.format(data.total)} dòng` : '0 dòng';
  $('page-input').value = page;
  $('page-input').max = totalPages;
  $('page-total').textContent = `/ ${format.format(totalPages)}`;
  $('table-region').scrollTop = 0;
}

async function fetchTable(table, targetPage) {
  render(await api(`/api/table?table=${encodeURIComponent(table)}&page=${targetPage}`));
}
function load(table, targetPage = 1) {
  return run(() => fetchTable(table, targetPage), 'Đang tải dữ liệu…', () => load(table, targetPage));
}
function processData() {
  return run(async () => {
    const meta = await api('/api/process', 'POST');
    available = meta.available;
    await fetchTable('processed', 1);
  }, 'Đang làm sạch giao dịch và tính RFM. Vui lòng chờ…', processData);
}
function clusterData() {
  return run(async () => {
    const meta = await api('/api/cluster', 'POST');
    available = meta.available;
    await fetchTable('clustered', 1);
  }, 'Đang chuẩn hóa RFM và phân cụm FCM. Vui lòng chờ…', clusterData);
}
$('process-button').addEventListener('click', processData);
$('cluster-button').addEventListener('click', clusterData);
$('retry-button').addEventListener('click', () => retryAction?.());
document.querySelectorAll('[data-table]').forEach((button) => button.addEventListener('click', () => load(button.dataset.table)));
$('previous').addEventListener('click', () => load(current, page - 1));
$('next').addEventListener('click', () => load(current, page + 1));
$('page-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const target = Number($('page-input').value);
  if (Number.isInteger(target) && target >= 1 && target <= totalPages) load(current, target);
});
load('raw');
