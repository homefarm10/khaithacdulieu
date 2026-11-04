import contextlib
import csv
import io
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import numpy as np
import pandas as pd
from sklearn.preprocessing import StandardScaler

from worker import DataService, RequestError
from xulydl import xulydulieu
from FCM import FCM


class WorkerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.path = Path(cls.temp.name) / "data.csv"
        with cls.path.open("w", newline="", encoding="utf-8") as output:
            writer = csv.writer(output)
            writer.writerow(["Invoice", "StockCode", "Description", "Quantity", "InvoiceDate", "Price", "Customer ID", "Country"])
            for i in range(120):
                for j in range(1 + i % 9):
                    writer.writerow([f"I{i}-{j}", "001A", 'Product, "demo"', 1 + i % 17,
                                     f"2011-{1 + i % 12:02d}-{1 + j:02d} 10:00", 1.25 + i, 12000 + i, "United Kingdom"])
            writer.writerow(["C1", "002", "Cancelled", 1, "2011-01-01 10:00", 2, 99001, "UK"])
            writer.writerow(["I2", "003", "Missing customer", 1, "2011-01-01 10:00", 2, "", "UK"])
            writer.writerow(["I3", "004", "Negative quantity", -1, "2011-01-01 10:00", 2, 99002, "UK"])
            writer.writerow(["I4", "005", "Zero price", 1, "2011-01-01 10:00", 0, 99003, "UK"])

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def test_raw_pagination_preserves_every_cell(self):
        service = DataService(self.path)
        expected = pd.read_csv(self.path, dtype=str, keep_default_na=False)
        first = service.handle({"action": "table"})
        rows = []
        for page in range(1, first["totalPages"] + 1):
            result = service.handle({"action": "table", "page": page})
            rows.extend(result["rows"])
        self.assertEqual(first["columns"], list(expected.columns))
        self.assertEqual(rows, expected.values.tolist())
        self.assertEqual(len(rows), first["total"])
        for page in (0, -1, 1.5, True, first["totalPages"] + 1):
            with self.assertRaises(RequestError):
                service.handle({"action": "table", "page": page})

    def test_rfm_and_fcm_match_existing_functions(self):
        service = DataService(self.path)
        with contextlib.redirect_stdout(io.StringIO()):
            expected = xulydulieu(self.path, save_csv=False)
            service.handle({"action": "process"})
        pd.testing.assert_frame_equal(service.tables["processed"], expected)
        self.assertEqual(len(expected), 120)
        transformed = StandardScaler().fit_transform(np.log1p(expected[["Recency", "Frequency", "Monetary"]]))
        model = FCM(expected.Segment.nunique(), m=1.5).fit(transformed)
        service.handle({"action": "cluster"})
        actual = service.tables["clustered"]
        np.testing.assert_array_equal(actual.FCM_Label, model.predict(model.U))
        pd.testing.assert_frame_equal(actual.drop(columns="FCM_Label"), expected)
        self.assertEqual(actual.FCM_Label.min(), 0)
        service.handle({"action": "process"})
        self.assertIn("clustered", service.tables)

    def test_missing_data_and_wrong_order(self):
        service = DataService(self.path.parent / "absent.csv")
        with self.assertRaises(FileNotFoundError):
            service.handle({"action": "table"})
        with self.assertRaises(RequestError) as error:
            service.handle({"action": "cluster"})
        self.assertEqual(error.exception.status, 409)

    def test_protocol_and_missing_dependencies(self):
        worker = Path(__file__).resolve().parents[1] / "worker.py"
        result = subprocess.run([sys.executable, "-S", str(worker)], input="", text=True, capture_output=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("ModuleNotFoundError", result.stderr)
        self.assertEqual(result.stdout, "")


if __name__ == "__main__":
    unittest.main()
