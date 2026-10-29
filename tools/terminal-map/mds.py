"""Deterministic 2D MDS: classical (Torgerson) start, weighted SMACOF refinement, canonical frame.

No randomness anywhere. Inputs are small (<= ~30 points per star system). See
docs/terminal-map.md §4.
"""

from __future__ import annotations

import math

import numpy as np

MAX_ITERATIONS = 500
TOLERANCE = 1e-9
WEIGHTINGS = {
    "uniform": lambda d: np.ones_like(d),
    "1/sqrt(d)": lambda d: 1.0 / np.sqrt(d),
    "1/d": lambda d: 1.0 / d,
}


def fill_missing(d: np.ndarray, known: np.ndarray) -> np.ndarray:
    """Replace unknown entries with the shortest path over the known pairs (an upper bound)."""
    n = len(d)
    out = np.where(known, d, np.inf)
    np.fill_diagonal(out, 0.0)
    for k in range(n):
        out = np.minimum(out, out[:, k : k + 1] + out[k : k + 1, :])
    if not np.isfinite(out).all():
        raise ValueError("the known distances do not connect all points")
    return out


def _fix_sign(vector: np.ndarray) -> np.ndarray:
    """Largest component positive: makes eigenvector signs independent of the LAPACK build."""
    return vector if vector[int(np.argmax(np.abs(vector)))] >= 0 else -vector


def classical_mds(d: np.ndarray) -> tuple[np.ndarray, float]:
    """(n x 2 coordinates, planar share = (l1+l2) / sum of the positive eigenvalues)."""
    n = len(d)
    j = np.eye(n) - np.ones((n, n)) / n
    b = -0.5 * j @ (d * d) @ j
    b = (b + b.T) / 2
    values, vectors = np.linalg.eigh(b)
    order = np.argsort(-values, kind="stable")
    values, vectors = values[order], vectors[:, order]
    x = np.column_stack([_fix_sign(vectors[:, k]) * math.sqrt(max(values[k], 0.0)) for k in range(2)])
    positive = float(np.sum(np.maximum(values, 0.0)))
    share = float(max(values[0], 0.0) + max(values[1], 0.0)) / positive if positive > 0 else 1.0
    return x, share


def _distances(x: np.ndarray) -> np.ndarray:
    diff = x[:, None, :] - x[None, :, :]
    return np.sqrt((diff * diff).sum(axis=2))


def stress(delta: np.ndarray, w: np.ndarray, x: np.ndarray) -> float:
    return float(np.triu(w * (delta - _distances(x)) ** 2, 1).sum())


def smacof(delta: np.ndarray, w: np.ndarray, x0: np.ndarray) -> np.ndarray:
    """Weighted stress majorization (Guttman transform); pairs with weight 0 are ignored."""
    n = len(delta)
    v = np.diag(w.sum(axis=1)) - w
    ones = np.ones((n, n)) / n
    v_pinv = np.linalg.inv(v + ones) - ones
    x = x0.copy()
    current = stress(delta, w, x)
    for _ in range(MAX_ITERATIONS):
        dist = _distances(x)
        ratio = np.divide(delta, dist, out=np.zeros_like(delta), where=dist > 1e-12)
        b = -w * ratio
        np.fill_diagonal(b, 0.0)
        np.fill_diagonal(b, -b.sum(axis=1))
        x = v_pinv @ (b @ x)
        new = stress(delta, w, x)
        done = current - new <= TOLERANCE * max(current, 1e-300)
        current = new
        if done:
            break
    return x


def canonical_frame(x: np.ndarray) -> np.ndarray:
    """Centroid at the origin, principal axes (largest variance first), signs fixed so that
    sum(x * |x|) >= 0 on each axis (a tie is decided by the first point off the axis origin).
    Removes the rotation and reflection freedom of MDS."""
    x = x - x.mean(axis=0)
    values, vectors = np.linalg.eigh(x.T @ x)
    y = x @ vectors[:, np.argsort(-values, kind="stable")]
    for axis in range(y.shape[1]):
        column = y[:, axis]
        skew = float(np.sum(column * np.abs(column)))
        if abs(skew) < 1e-9:
            off = [c for c in column if abs(c) > 1e-9]
            skew = off[0] if off else 1.0
        if skew < 0:
            y[:, axis] = -column
    return y


def quality(delta: np.ndarray, known: np.ndarray, x: np.ndarray) -> dict[str, float]:
    """Metrics on the measured pairs only (unweighted)."""
    upper = np.triu(known, 1)
    d = delta[upper]
    e = _distances(x)[upper]
    return {
        "stress1": math.sqrt(float(((d - e) ** 2).sum() / (d * d).sum())),
        "meanRelError": float(np.mean(np.abs(d - e) / d)),
        "maxRelError": float(np.max(np.abs(d - e) / d)),
    }


def embed(d: np.ndarray, known: np.ndarray, weighting: str) -> tuple[np.ndarray, float]:
    """Orbit points for one star system: (canonical n x 2 coordinates, planar share)."""
    filled = fill_missing(d, known)
    x0, share = classical_mds(filled)
    safe = np.where(known & (d > 0), d, 1.0)
    w = np.where(known & (d > 0), WEIGHTINGS[weighting](safe), 0.0)
    np.fill_diagonal(w, 0.0)
    return canonical_frame(smacof(filled, w, x0)), share
