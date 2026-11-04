from FCM import *
from SSFCM import *
from Dokq import *
from xulydl import *
import pandas as pd
from sklearn.preprocessing import StandardScaler
from sklearn.preprocessing import LabelEncoder


clean_data = xulydulieu("data.csv")
df = clean_data

X = df[["Recency",	"Frequency", "Monetary"]].copy()

# Giảm độ lệch và nén các giá trị lớn
X_log = np.log1p(X)

# Chuẩn hóa trước khi phân cụm
scaler = StandardScaler()
X_scaled = scaler.fit_transform(X_log)

labelencoder = LabelEncoder()
Y = labelencoder.fit_transform(df["Segment"])

c = len(np.unique(Y))
print("Số nhãn:", c)



fcm = FCM(c, m = 1.5) 
fcm.fit(X_scaled)
labels_pred = fcm.predict(fcm.U) 
centers_scaled = fcm.V

fcm_metrics = print_clustering_metrics(
    "FCM", X_scaled, fcm.V, fcm.U, Y, m=fcm.m, align_labels=True
)