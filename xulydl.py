import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
from scipy.spatial.distance import cdist
import math

def xulydulieu(path, save_csv=True):
    
    # Load data
    df = pd.read_csv(path)
    print(df.shape)

    # 2. Làm sạch dữ liệu
    df = df.dropna(subset=["Customer ID", "InvoiceDate"]).copy()
    df["InvoiceDate"] = pd.to_datetime(df["InvoiceDate"])

    # Bỏ hóa đơn hủy, số lượng và giá không hợp lệ
    df = df[
        ~df["Invoice"].astype(str).str.upper().str.startswith("C")
        & (df["Quantity"] > 0)
        & (df["Price"] > 0)
    ].copy()

    df["Customer ID"] = df["Customer ID"].astype("int64")


    # 3. Tính tiền của từng dòng sản phẩm
    df["TotalPrice"] = df["Quantity"] * df["Price"]


    # Ngày phân tích: sau ngày mua cuối cùng trong dữ liệu 1 ngày
    snapshot_date = df["InvoiceDate"].max().normalize() + pd.Timedelta(days=1)



    # 4. Tính RFM theo từng khách hàng
    rfm = df.groupby("Customer ID").agg(
        Recency=("InvoiceDate",
                lambda dates: (snapshot_date - dates.max().normalize()).days),
        Frequency=("Invoice", "nunique"),
        Monetary=("TotalPrice", "sum")
    ).reset_index()

    rfm["Monetary"] = rfm["Monetary"].round(2)

    print("Ngày phân tích:", snapshot_date.date())
    print(rfm.head(10))

    print("Số hàng dữ liệu trong rfm:", len(rfm))



    # Tính các ngưỡng riêng cho từng cột
    quantiles = rfm[["Recency", "Frequency", "Monetary"]].quantile(
        [0.2, 0.4, 0.6, 0.8]
    )

    # Recency: số ngày càng thấp, điểm càng cao
    def RScore(x, thresholds):
        if x <= thresholds[0.2]:
            return 5
        elif x <= thresholds[0.4]:
            return 4
        elif x <= thresholds[0.6]:
            return 3
        elif x <= thresholds[0.8]:
            return 2
        else:
            return 1

    # Frequency và Monetary: giá trị càng cao, điểm càng cao
    def FMScore(x, thresholds):
        if x <= thresholds[0.2]:
            return 1
        elif x <= thresholds[0.4]:
            return 2
        elif x <= thresholds[0.6]:
            return 3
        elif x <= thresholds[0.8]:
            return 4
        else:
            return 5

    # Chấm điểm
    rfm["R_Score"] = rfm["Recency"].apply(
        RScore, args=(quantiles["Recency"],)
    )

    rfm["F_Score"] = rfm["Frequency"].apply(
        FMScore, args=(quantiles["Frequency"],)
    )

    rfm["M_Score"] = rfm["Monetary"].apply(
        FMScore, args=(quantiles["Monetary"],)
    )

    # Ghép ba điểm thành mã RFM
    rfm["RFM_Score"] = (
        rfm["R_Score"].astype(str)
        + rfm["F_Score"].astype(str)
        + rfm["M_Score"].astype(str)
    )

    print(rfm.head())


    df_data = rfm[[
        "Customer ID",
        "Recency",
        "Frequency",
        "Monetary",
        "R_Score",
        "F_Score",
        "M_Score",
        "RFM_Score"
    ]].copy()

    print(df_data.head())


    # 1. Tính điểm theo các mốc phân vị 20%, 40%, 60%, 80%.
    # Các giá trị bằng nhau nhận cùng điểm.

    # 2. Quy tắc chia nhóm theo bảng trong ảnh.
    segment_rules = {
        "Champions":
            "555 554 544 545 454 455 445",

        "Loyal Customers":
            "543 444 435 355 354 345 344 335",

        "Potential Loyalist":
            "553 551 552 541 542 533 532 531 452 451 442 441 "
            "431 453 433 432 423 353 352 351 342 341 333 323",

        "Recent Customers":
            "512 511 422 421 412 411 311",

        "Promising":
            "525 524 523 522 521 515 514 513 425 424 413 414 "
            "415 315 314 313",

        "Customers Needing Attention":
            "535 534 443 434 343 334 325 324",

        "About To Sleep":
            "331 321 312 221 213",

        "At Risk":
            "255 254 245 244 253 252 243 242 235 234 225 224 "
            "153 152 145 143 142 135 134 133 125 124",

        "Can't Lose Them":
            "155 154 144 214 215 115 114 113",

        "Hibernating":
            "332 322 231 241 251 233 232 223 222 132 123 122 212 211",

        "Lost":
            "111 112 121 131 141 151",
    }

    label_map = {
        score: segment
        for segment, scores in segment_rules.items()
        for score in scores.split()
    }

    df_data["Segment"] = df_data["RFM_Score"].map(label_map).fillna("Unclassified")

    print(df_data.head())

    if save_csv:
        df_data.to_csv("rfm_data.csv", index=False, encoding="utf-8-sig")
    return df_data

