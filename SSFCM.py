from scipy.spatial.distance import cdist
import numpy as np
import math



import numpy as np
from scipy.spatial.distance import cdist
import time


class SSFCM:
    def __init__(self, clusters, m=2, max_iter=1000, eps=1e-5, per=30):
        self.clusters = clusters
        self.m = m
        self.max_iter = max_iter
        self.eps = eps
        self.per = per
        self.U_bar = None
        self.process_time = 0


    # ================== Tạo ngẫu nhiên nhãn =========
    def mask_labels_balanced(y, percent=30):
        y = np.array(y)
        y_partial = np.full(len(y), -1)

        classes = np.unique(y)

        for c in classes:
            idx = np.where(y == c)[0]
            num_keep = int(len(idx) * percent / 100)

            keep_idx = np.random.choice(idx, num_keep, replace=False)
            y_partial[keep_idx] = c

        return y_partial
    # ================== FCM CORE ==================

    def initialize_random_membership_matrix(self, data):
        np.random.seed(42)
        n = data.shape[0]
        U = np.random.rand(n, self.clusters)
        U = U / np.sum(U, axis=1, keepdims=True)
        return U

    def calculate_centroid(self, data, U):
        Um = U ** self.m
        TS = np.dot(Um.T, data)
        MS = np.sum(Um.T, axis=1, keepdims=True)
        return TS / MS

    def update_membership_matrix(self, data, centroids):
        distance = cdist(data, centroids, metric='sqeuclidean')

        # tránh chia cho 0
        distance = np.fmax(distance, 1e-10)

        power = 1 / (self.m - 1)
        inv_dist = distance ** (-power)

        U = inv_dist / np.sum(inv_dist, axis=1, keepdims=True)
        return U

    # ================== SEMI-SUPERVISED ==================

    def init_U_bar(self, labels):
        self.U_bar = np.zeros((len(labels), self.clusters))
        for i in range(len(labels)):
            if labels[i] != -1 and labels[i] < self.clusters:
                self.U_bar[i][labels[i]] = 1
         # Đếm số lượng giá trị 1 ở từng cột
        count = np.sum(self.U_bar == 1, axis=0)
    
        # print("Number of labeled samples per cluster:")
        # for i, c in enumerate(count):
        #     print(f"Cluster {i}: {c}")
        return self.U_bar

    def calculate_centroid_ss(self, data, U):
        U_eff = np.abs(U - self.U_bar)
        # U_eff = U - self.U_bar
        return self.calculate_centroid(data, U_eff)

    def update_membership_matrix_ss(self, data, centroids):
        u = self.update_membership_matrix(data, centroids)
        matrix_1_Sum_U = 1 - np.sum(self.U_bar, axis=1, keepdims=True)
        return self.U_bar + matrix_1_Sum_U * u

    # ================== TRAIN ==================

    def fit(self, data, labels):
        self.U_bar = self.init_U_bar(labels)
        U = self.initialize_random_membership_matrix(data)

        starttime = time.time()

        for i in range(self.max_iter):
            centroids = self.calculate_centroid_ss(data, U)
            new_U = self.update_membership_matrix_ss(data, centroids)

            if np.linalg.norm(new_U - U) < self.eps:
                break

            U = new_U.copy()

        self.process_time = time.time() - starttime
        final_labels = np.argmax(U, axis=1) # là hàm def predict(self, U):

        return centroids, U, final_labels, i

    # ================== PREDICT ==================

    def predict(self, U):
        return np.argmax(U, axis=1)



def mask_labels_balanced(y, percent=30):
    y = np.array(y)
    label = np.full(len(y), -1)

    classes = np.unique(y)

    for c in classes:
        # print("class:", c)
        idx = np.where(y == c)[0]
        if int(len(idx) * percent / 100) <= 1: 
            num_keep = 1
            # print(num_keep)
        else:
            num_keep = int(len(idx) * percent / 100)
            # print(num_keep)
        np.random.seed(42)
        keep_idx = np.random.choice(idx, num_keep, replace=False)
        label[keep_idx] = c

    return label

