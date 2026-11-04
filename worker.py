"""Persistent JSON-lines bridge. stdout is reserved for protocol responses."""
import contextlib
import json
from pathlib import Path
import sys
import traceback

import numpy as np
import pandas as pd
from sklearn.preprocessing import StandardScaler

from FCM import FCM
from xulydl import xulydulieu


class RequestError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


class DataService:
    def __init__(self, path):
        self.path = Path(path)
        self.tables = {}
        self.cluster_count = None

    def metadata(self):
        return {
            "available": list(self.tables),
            "counts": {name: len(frame) for name, frame in self.tables.items()},
            "clusterCount": self.cluster_count,
        }

    def handle(self, request):
        action = request.get("action")
        if action == "table":
            name = request.get("table", "raw")
            if name not in ("raw", "processed", "clustered"):
                raise RequestError("Bảng dữ liệu không hợp lệ.")
            page = request.get("page", 1)
            if type(page) is not int or page < 1:
                raise RequestError("Số trang phải là số nguyên dương.")
            if name == "raw" and name not in self.tables:
                # Preserve source text, including empty cells and product codes.
                self.tables["raw"] = pd.read_csv(
                    self.path, dtype=str, keep_default_na=False
                )
            if name not in self.tables:
                raise RequestError("Chưa có dữ liệu cho bước này.", 409)
            frame = self.tables[name]
            pages = max(1, (len(frame) + 49) // 50)
            if page > pages:
                raise RequestError("Trang vượt quá số trang hiện có.")
            rows = json.loads(frame.iloc[(page - 1) * 50:page * 50].to_json(
                orient="values", force_ascii=False, double_precision=15
            ))
            return {
                "table": name, "columns": list(frame.columns), "rows": rows,
                "page": page, "pageSize": 50, "total": len(frame),
                "totalPages": pages, **self.metadata(),
            }
        if action == "process":
            if "processed" not in self.tables:
                frame = xulydulieu(self.path, save_csv=False)
                if frame.empty:
                    raise RequestError("Không còn khách hàng hợp lệ sau khi làm sạch.", 422)
                self.tables["processed"] = frame
            return self.metadata()
        if action == "cluster":
            if "processed" not in self.tables:
                raise RequestError("Hãy xử lý dữ liệu trước khi chạy FCM.", 409)
            if "clustered" not in self.tables:
                frame = self.tables["processed"]
                features = StandardScaler().fit_transform(
                    np.log1p(frame[["Recency", "Frequency", "Monetary"]])
                )
                count = frame["Segment"].nunique()
                model = FCM(count, m=1.5)
                model.fit(features)
                if not np.isfinite(model.U).all():
                    raise RequestError("FCM không hội tụ về kết quả hợp lệ trên dữ liệu này.", 422)
                result = frame.copy()
                result["FCM_Label"] = model.predict(model.U)
                self.tables["clustered"] = result
                self.cluster_count = int(count)
            return self.metadata()
        raise RequestError("Thao tác không hợp lệ.")


def main():
    service = DataService(sys.argv[1] if len(sys.argv) > 1 else "data.csv")
    for line in sys.stdin:
        request = {}
        try:
            request = json.loads(line)
            with contextlib.redirect_stdout(sys.stderr):
                data = service.handle(request)
            response = {"id": request.get("id"), "data": data}
        except Exception as error:
            traceback.print_exc(file=sys.stderr)
            if isinstance(error, RequestError):
                message, status = str(error), error.status
            elif isinstance(error, FileNotFoundError):
                message, status = "Không tìm thấy data.csv. Kiểm tra file trong thư mục dự án.", 500
            else:
                message, status = "Không thể xử lý dữ liệu. Xem chi tiết trong cửa sổ chạy server.", 500
            response = {"id": request.get("id"), "error": message, "status": status}
        print(json.dumps(response, ensure_ascii=False, allow_nan=False), flush=True)


if __name__ == "__main__":
    main()
