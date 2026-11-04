# Customer Lab — Phân cụm khách hàng

Giao diện tiếng Việt chạy trên localhost với Node.js / Express. Python thực hiện xử lý RFM và FCM bằng code có sẵn trong dự án.

## Cài đặt trên Windows

Cần Node.js 20 trở lên và Python 3.10 trở lên, có trong PATH. Mở PowerShell tại thư mục dự án:

```powershell
npm install
python -m pip install -r requirements.txt
npm start
```

Mở **http://localhost:3000**. Giữ cửa sổ PowerShell đang chạy; nhấn `Ctrl+C` để dừng server. Server chỉ lắng nghe `127.0.0.1:3000`.

Nếu dùng môi trường Python riêng:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
$env:PYTHON = (Resolve-Path .\.venv\Scripts\python.exe).Path
npm start
```

Nếu PowerShell chặn `npm.ps1` do Execution Policy, dùng `npm.cmd install`, `npm.cmd start`, `npm.cmd test` tương ứng; không cần đổi chính sách hệ thống.

`PYTHON` phải là đường dẫn tới file thực thi Python, không kèm tham số. `npm start` có thể gọi từ thư mục dự án bất kể Python đang dùng môi trường nào.

## Sử dụng

1. Trang đầu hiển thị 8 cột gốc từ `data.csv`. Mỗi trang có tối đa 50 dòng; dùng nút mũi tên hoặc nhập số trang rồi Enter để di chuyển.
2. Nhấn **Phân cụm khách hàng** để làm sạch giao dịch, tính RFM và xem bảng theo khách hàng.
3. Nhấn **Phân cụm bằng FCM** để thêm cột `FCM_Label`. Có thể chuyển qua lại ba bảng bằng thanh chọn.

`Segment` là nhóm theo quy tắc RFM. `FCM_Label` là nhãn nguyên từ **0**, lấy trực tiếp từ `FCM.predict()`, không đổi tên theo Segment. FCM dùng `log1p` và `StandardScaler` trên Recency/Frequency/Monetary, `m=1.5`, số cụm bằng số Segment khác nhau, seed 42, tối đa 1000 vòng lặp và epsilon 1e-5.

Ứng dụng dùng cố định `data.csv` cạnh `server.js`. Bảng gốc giữ giá trị dạng chuỗi, kể cả ô trống và mã sản phẩm. Kết quả lưu trong bộ nhớ tiến trình Python; khởi động lại server hoặc Python sẽ đặt lại phiên. Nhấn lại nút đã chạy sẽ dùng kết quả có sẵn. Web không ghi đè `rfm_data.csv`; gọi `xulydulieu(path)` từ code Python cũ vẫn ghi file như trước.

## API và cấu trúc

- `GET /api/table?table=raw|processed|clustered&page=1`: trả `columns`, `rows` (mảng giá trị theo thứ tự cột), `total`, `page`, `pageSize=50`, `totalPages` và metadata `available`, `counts`, `clusterCount`.
- `POST /api/process`: tính bảng RFM, trả metadata.
- `POST /api/cluster`: tính FCM, trả metadata; trả HTTP 409 nếu chưa xử lý RFM.

Node.js gọi `worker.py` bằng `spawn` không qua shell. Giao tiếp JSON theo dòng trên stdout; log Python đi ra stderr. Chỉ một yêu cầu Python chạy tại một thời điểm; yêu cầu trùng lúc trả HTTP 409. Mỗi yêu cầu có giới hạn 5 phút; quá hạn sẽ dừng worker và đặt lại phiên. Các file Python phân tích sẵn có không cần chạy thủ công trước khi mở web.

## Kiểm tra và xử lý lỗi

```powershell
npm test
```

Kiểm thử API, phân trang, luồng RFM/FCM so với thuật toán trực tiếp, tác vụ đồng thời, thiếu file/Python/thư viện và worker dừng bất ngờ. Để kiểm tra bằng dữ liệu thật trong dự án:

```powershell
node tests/verify-real-data.js
```

Kiểm tra thao tác trên trình duyệt desktop và mobile bằng Chrome/Edge đã cài (Node.js 22 trở lên, không tải trình duyệt mới):

```powershell
node tests/browser-smoke.js
```

Có thể đặt `BROWSER_PATH` tới file thực thi Chrome/Edge nếu dùng đường dẫn khác. Ảnh kiểm tra nằm tại `.preview/desktop.png` và `.preview/mobile.png`.

Nếu không mở được web, kiểm tra cửa sổ server và cổng 3000. Nếu Python lỗi, cài thư viện bằng đúng Python được chọn trong `PYTHON`. Chi tiết lỗi xuất ở cửa sổ server; giao diện có nút thử lại. Không có file dữ liệu nào được phục vụ trực tiếp qua thư mục public.
