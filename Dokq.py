import numpy as np
from scipy.spatial.distance import cdist
import math

def silhouette(data: np.ndarray, labels: np.ndarray) -> float:
    from sklearn.metrics import silhouette_score
    return silhouette_score(data, labels)

def davies_bouldin(data: np.ndarray, labels: np.ndarray) -> float:
    from sklearn.metrics import davies_bouldin_score
    return davies_bouldin_score(data, labels)

def partition_coefficient(membership: np.ndarray) -> float:
    N, C = membership.shape
    _pc = np.sum(np.square(membership)) / N  # PC fuzzy
    _1dc = 1/C
    return (_pc - _1dc) / (1 - _1dc)

def extract_labels(membership: np.ndarray) -> np.ndarray:
    return np.argmax(membership, axis=1)

def Xie_Benie(data: np.ndarray, centroids: np.ndarray,
              membership: np.ndarray, m: float = 2) -> float:
    # XB = sum(u_ij ** m * ||x_i - v_j||^2) / (N * min ||v_j - v_k||^2).
    # Reference: https://www.mdpi.com/2078-2489/11/9/446
    if len(centroids) < 2:
        return np.nan
    squared_distances = cdist(data, centroids, metric="sqeuclidean")
    center_distances = cdist(centroids, centroids, metric="sqeuclidean")
    # Only exclude the diagonal: distinct coincident centers mean XB = inf.
    np.fill_diagonal(center_distances, np.inf)
    min_separation = np.min(center_distances)
    if min_separation <= 0:
        return np.inf
    numerator = np.sum((membership ** m) * squared_distances)
    return float(numerator / (len(data) * min_separation))

def accuracy_score(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    from sklearn.metrics import accuracy_score
    return accuracy_score(y_true, y_pred)

def f1_score(y_true: np.ndarray, y_pred: np.ndarray, average: str = 'weighted') -> float:  # binary|weighted
    from sklearn.metrics import f1_score
    return f1_score(y_true, y_pred, average=average)

def print_clustering_metrics(name, data, centroids, membership, y_true,
                             m=2, align_labels=False):
    """Print six validity scores; optionally match cluster IDs to true labels."""
    from scipy.optimize import linear_sum_assignment

    labels = extract_labels(membership)
    y_true = np.asarray(y_true)
    y_pred = labels.copy()

    if align_labels:
        # FCM cluster IDs are arbitrary: match them before Accuracy and F1.
        classes, true_ids = np.unique(y_true, return_inverse=True)
        contingency = np.zeros((len(classes), membership.shape[1]), dtype=int)
        np.add.at(contingency, (true_ids, labels), 1)
        class_ids, cluster_ids = linear_sum_assignment(-contingency)
        mapping = dict(zip(cluster_ids, classes[class_ids]))
        for cluster_id in range(membership.shape[1]):
            if cluster_id not in mapping:
                mapping[cluster_id] = classes[contingency[:, cluster_id].argmax()]
        y_pred = np.array([mapping[label] for label in labels])

    valid_partition = 2 <= len(np.unique(labels)) < len(data)
    scores = {
        "Silhouette": silhouette(data, labels) if valid_partition else np.nan,
        "Davies-Bouldin": davies_bouldin(data, labels) if valid_partition else np.nan,
        "Partition Coefficient (normalized)": (
            partition_coefficient(membership) if membership.shape[1] > 1 else np.nan
        ),
        "Xie-Beni": Xie_Benie(data, centroids, membership, m=m),
        "Accuracy": accuracy_score(y_true, y_pred),
        "F1 (weighted)": f1_score(y_true, y_pred, average="weighted"),
    }
    print(f"\n=== {name} ===")
    for metric, value in scores.items():
        print(f"{metric:<36}: {value:.6f}")
    if not valid_partition:
        print("Silhouette / Davies-Bouldin: undefined for this number of clusters.")
    return scores
