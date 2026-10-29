"""Travel distances between all nodes (docs/terminal-map.md §2.5 and §5.4).

The directed graph per star system follows the product owner's travel rules; jumps join the
gateway stations of different systems. All pairs are solved with Floyd-Warshall in float64:
`min` and `+` only, so the result does not depend on the order of equal-cost paths.
"""

from __future__ import annotations

from typing import Callable

import numpy as np

CO_ORBIT_COST = 0.15  # Gm between two nodes on one orbit (the spread of the layout, a convention)


def _is_entry(node: dict) -> bool:
    return node["group"] is None or node["group"] == node["id"]


def edge_allowed(a: dict, b: dict) -> bool:
    """May one travel directly from `a` to `b` inside one star system?

    Entering a planetary group is only possible at its planet (or at a standalone node);
    leaving works from any member, and inside one group everything is direct."""
    if a["id"] == b["id"]:
        return False
    return _is_entry(b) or a["group"] == b["group"]


def travel_matrix(
    nodes: list[dict],
    jumps: list[dict],
    orbit_distance: Callable[[int, int, int], float],
) -> list[float | None]:
    """Row-major N*N list in `nodes` order: shortest directed travel distance in Gm (3 decimals),
    None where unreachable, 0 on the diagonal. `orbit_distance(system, orbit_a, orbit_b)` is the
    reported distance between two orbits, or the distance of the fitted points when none is reported."""
    n = len(nodes)
    index = {node["id"]: i for i, node in enumerate(nodes)}
    d = np.full((n, n), np.inf)
    for i, a in enumerate(nodes):
        d[i, i] = 0.0
        for j, b in enumerate(nodes):
            if a["system"] != b["system"] or not edge_allowed(a, b):
                continue
            same_orbit = a["orbitId"] == b["orbitId"]
            d[i, j] = CO_ORBIT_COST if same_orbit else orbit_distance(a["system"], a["orbitId"], b["orbitId"])
    for jump in jumps:
        i, j = index[jump["a"]], index[jump["b"]]
        d[i, j] = d[j, i] = min(d[i, j], jump["cost"])
    for k in range(n):
        d = np.minimum(d, d[:, k, None] + d[None, k, :])
    return [None if not np.isfinite(v) else (0.0 if round(float(v), 3) == 0 else round(float(v), 3)) for v in d.ravel()]
