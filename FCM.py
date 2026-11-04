from scipy.spatial.distance import cdist
import numpy as np
import math


class FCM:

    # hàm khởi tạo
    def __init__(self, c: int, m: int = 2, max_iters: int = 1000, eps: float = 1e-5):
        self.c=c
        self.m=m
        self.max_iters=max_iters
        self.eps=eps
        self.U=None
        self.V=None
        self.process_time=0

    # khởi tạo ma trận thành viên ngẫu nhiên
    def initialize_U(self, data : np.ndarray)-> np.ndarray:
        n=data.shape[0] #lấy số lượng điểm dữ liệu
        np.random.seed(seed=42)
        U = np.random.rand(n, self.c)
        U = U/np.sum(U, axis=1, keepdims=True)
        return U

    #tính tâm cụm
    def calculate_V(self, data: np.ndarray) -> np.ndarray:
        um = self.U ** self.m
        return (um.T @ data) / division_by_zero(np.sum(um.T, axis=1, keepdims=True))

    #Cập nhật ma trận thành viên
    def update_membership_matrix(self, data: np.ndarray) -> np.ndarray:
        distance = cdist(data, self.V, metric='euclidean') ** (2 / (self.m - 1))
        D = [distance[:, j] for j in range(self.c)]
        numerator = 1 / np.array(D)
        denominator = np.sum(numerator, axis=0)
        U = numerator / division_by_zero(denominator)
        return np.squeeze(U).T

    def fit(self, data: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray, int]:
        import time
        self.U = self.initialize_U(data)
        start_time = time.time()

        for i in range(self.max_iters):
            U_old = self.U.copy()
            self.V = self.calculate_V(data)
            self.U = self.update_membership_matrix(data)
            if np.linalg.norm(self.U - U_old) < self.eps:
                break

        end_time = time.time()
        self.process_time = end_time - start_time
        return self   # Trả về số vòng lặp thực tế

    def predict(self, U):
        return np.argmax(U, axis=1)
def division_by_zero(data: np.ndarray | float) -> np.ndarray | float:
        if isinstance(data, np.ndarray):
            data[data == 0] = np.finfo(float).eps
            return data
        return np.finfo(float).eps if data == 0 else data
