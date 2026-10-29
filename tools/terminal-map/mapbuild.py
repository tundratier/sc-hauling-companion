"""Build the terminal map data file from the committed raw files (no network).

Inputs: raw/<version>/metadata.json (trimmed UEX metadata) and every raw/<version>/*.jsonl
with `orbits_distances` responses. Output: one JSON text, byte-stable for the same input.
See docs/terminal-map.md §4 and §5.
"""

from __future__ import annotations

import json
import math
from collections import defaultdict
from pathlib import Path

import numpy as np

import mds
from nodes import build, load_snapshot

SCHEMA_VERSION = 1
WEIGHTING = "1/d"
JUMP_COST = 70.0  # Gm, constant (product owner decision)
CO_ORBIT_SPREAD = 0.15  # Gm
PANEL_GAP = 20.0  # Gm between system panels in the combined layout
KIND_RANK = {"planet": 0, "moon": 1, "station": 2, "orbit": 3}


def _r(value: float, digits: int = 3) -> float:
    rounded = round(float(value), digits)
    return 0.0 if rounded == 0 else rounded


def _version_key(version: str) -> tuple:
    parts = []
    for part in version.split("."):
        digits = "".join(c for c in part if c.isdigit())
        parts.append((int(digits) if digits else 0, part[len(digits) :]))
    return tuple(parts)


def _numeric_id(node_id: str) -> int:
    return int(node_id.split(":")[1])


def load_orbit_rows(raw_dir: Path, version: str) -> dict[tuple[int, int], dict]:
    """Latest reported row per directed orbit pair, from every orbits_distances response."""
    latest: dict[tuple[int, int], dict] = {}
    for file in sorted((raw_dir / version).glob("*.jsonl")):
        for line in file.read_text(encoding="utf-8").splitlines():
            record = json.loads(line)
            if not record["request"].startswith("orbits_distances"):
                continue
            for row in record["response"]["data"]:
                key = (int(row["id_orbit_origin"]), int(row["id_orbit_destination"]))
                rank = (int(row["date_modified"]), int(row["id"]))
                if key not in latest or rank > latest[key]["rank"]:
                    latest[key] = {
                        "rank": rank,
                        "distance": float(row["distance"]),
                        "game_version": str(row["game_version"]),
                    }
    return latest


def system_matrix(orbits: list[int], rows: dict[tuple[int, int], dict]):
    """Symmetric distance matrix over `orbits`; both directions are averaged."""
    n = len(orbits)
    d = np.zeros((n, n))
    known = np.zeros((n, n), dtype=bool)
    versions: list[str] = []
    for i in range(n):
        for j in range(i + 1, n):
            # 0 Gm between two different orbits is a reporting error (Pyro IV <-> Pyro V), not data
            found = [
                rows[k]
                for k in ((orbits[i], orbits[j]), (orbits[j], orbits[i]))
                if k in rows and rows[k]["distance"] > 0
            ]
            if not found:
                continue
            d[i, j] = d[j, i] = sum(r["distance"] for r in found) / len(found)
            known[i, j] = known[j, i] = True
            versions += [r["game_version"] for r in found]
    return d, known, versions


def spread_co_orbit(system_nodes: list[dict], orbit_point: dict[int, tuple[float, float]]):
    """Node coordinates: the anchor of each orbit (its planet, else the lowest id) sits on the
    orbit's point, the other nodes of the orbit on a ring of CO_ORBIT_SPREAD Gm around it."""
    by_orbit: dict[int, list[dict]] = defaultdict(list)
    for node in system_nodes:
        by_orbit[node["orbit"]].append(node)
    placed: dict[str, tuple[float, float, bool]] = {}
    for orbit, members in by_orbit.items():
        members.sort(key=lambda n: (KIND_RANK[n["kind"]], _numeric_id(n["id"])))
        x, y = orbit_point[orbit]
        anchor = next((m for m in members if m["kind"] == "planet"), members[0])
        placed[anchor["id"]] = (_r(x), _r(y), False)
        others = [m for m in members if m is not anchor]
        for k, node in enumerate(others):
            angle = 2 * math.pi * k / len(others)
            placed[node["id"]] = (
                _r(x + CO_ORBIT_SPREAD * math.cos(angle)),
                _r(y + CO_ORBIT_SPREAD * math.sin(angle)),
                True,
            )
    return placed


def combined_layout(system_ids: list[int], coords: dict[int, list[tuple[str, float, float]]], jumps: list[dict]):
    """Panel centres on a circle in system-id order; each panel rotated to point its gateways at
    the panels they lead to."""
    n = len(system_ids)
    radius = {s: max((math.hypot(x, y) for _, x, y in coords[s]), default=0.0) for s in system_ids}
    largest = sorted(radius.values(), reverse=True)
    ring = (largest[0] + largest[1] + PANEL_GAP) if n >= 2 else 0.0
    centre = {
        s: (ring * math.cos(-math.pi / 2 + 2 * math.pi * k / n), ring * math.sin(-math.pi / 2 + 2 * math.pi * k / n))
        for k, s in enumerate(system_ids)
    }
    local = {s: {node_id: (x, y) for node_id, x, y in coords[s]} for s in system_ids}
    owner = {node_id: s for s in system_ids for node_id in local[s]}
    layout = {}
    for s in system_ids:
        sin_sum = cos_sum = 0.0
        for jump in jumps:
            for here, there in ((jump["a"], jump["b"]), (jump["b"], jump["a"])):
                if owner.get(here) != s or owner.get(there) in (None, s):
                    continue
                gx, gy = local[s][here]
                target = math.atan2(
                    centre[owner[there]][1] - centre[s][1], centre[owner[there]][0] - centre[s][0]
                )
                delta = target - math.atan2(gy, gx)
                sin_sum += math.sin(delta)
                cos_sum += math.cos(delta)
        rotation = math.atan2(sin_sum, cos_sum) if (sin_sum or cos_sum) else 0.0
        layout[s] = {"cx": _r(centre[s][0]), "cy": _r(centre[s][1]), "rotationDeg": _r(math.degrees(rotation))}
    return layout


def compile_data(raw_dir: Path, version: str, weighting: str = WEIGHTING) -> dict:
    data = load_snapshot(raw_dir, version)
    systems, nodes, _unaddressable, edges, _gateways, _ignored = build(data, None)
    rows = load_orbit_rows(raw_dir, version)

    by_system: dict[int, list[dict]] = defaultdict(list)
    for node in nodes.values():
        by_system[node["system"]].append(node)

    out_systems, out_nodes = [], []
    coords: dict[int, list[tuple[str, float, float]]] = {}
    for sid in sorted(by_system):
        members = by_system[sid]
        orbits = sorted({n["orbit"] for n in members})
        d, known, used_versions = system_matrix(orbits, rows)
        points, share = mds.embed(d, known, weighting)
        orbit_point = {o: (float(points[i, 0]), float(points[i, 1])) for i, o in enumerate(orbits)}
        placed = spread_co_orbit(members, orbit_point)
        coords[sid] = [(nid, x, y) for nid, (x, y, _) in placed.items()]
        pairs = len(orbits) * (len(orbits) - 1) // 2
        measured = int(np.triu(known, 1).sum())
        quality = mds.quality(d, known, points)
        out_systems.append(
            {
                "id": sid,
                "name": systems[sid]["name"],
                "orbitIds": orbits,
                "distances": [
                    [i, j, _r(d[i, j])] for i in range(len(orbits)) for j in range(i + 1, len(orbits)) if known[i, j]
                ],
                # pairs without a usable report: the distance of the fitted points (flagged, not data)
                "estimated": [
                    [i, j, _r(math.dist(points[i], points[j]))]
                    for i in range(len(orbits))
                    for j in range(i + 1, len(orbits))
                    if not known[i, j]
                ],
                "quality": {
                    **{k: _r(v, 4) for k, v in quality.items()},
                    "planarShare": _r(share, 4),
                    "pairs": pairs,
                    "estimatedPairs": pairs - measured,
                    "oldestRowVersion": min(used_versions, key=_version_key),
                    "newestRowVersion": max(used_versions, key=_version_key),
                },
            }
        )
        for node in sorted(members, key=lambda n: (KIND_RANK[n["kind"]], _numeric_id(n["id"]))):
            x, y, offset = placed[node["id"]]
            out_nodes.append(
                {
                    "id": node["id"],
                    "system": sid,
                    "kind": node["kind"],
                    "name": node["name"],
                    "orbitId": node["orbit"],
                    "group": node["parent"],
                    "terminalIds": sorted(node["terminals"]),
                    "hasCommodityTerminal": "commodity" in node["types"],
                    "x": x,
                    "y": y,
                    "offset": offset,
                }
            )

    jumps = [
        {"a": e["a"], "b": e["b"], "cost": JUMP_COST, "jumpPointIds": sorted(e["jump_point_ids"])} for e in edges
    ]
    layout = combined_layout(sorted(by_system), coords, jumps)
    for system in out_systems:
        system["layout"] = layout[system["id"]]
    order = {n["id"]: i for i, n in enumerate(out_nodes)}
    for jump in jumps:
        if order[jump["a"]] > order[jump["b"]]:
            jump["a"], jump["b"] = jump["b"], jump["a"]

    return {
        "schemaVersion": SCHEMA_VERSION,
        "gameVersion": version,
        "units": "Gm",
        "generator": {
            "source": "orbits_distances",
            "weights": weighting,
            "maxIterations": mds.MAX_ITERATIONS,
            "jumpCost": JUMP_COST,
            "coOrbitSpread": CO_ORBIT_SPREAD,
            "panelGap": PANEL_GAP,
        },
        "systems": out_systems,
        "nodes": out_nodes,
        "jumps": sorted(jumps, key=lambda j: (order[j["a"]], order[j["b"]])),
        "terminalNode": {str(t): n["id"] for n in out_nodes for t in n["terminalIds"]},
    }


def compile_version(raw_dir: Path, version: str) -> str:
    """The data file text: sorted keys, compact, LF, trailing newline."""
    return json.dumps(compile_data(raw_dir, version), sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n"

