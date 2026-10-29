"""Fetch step for a new game version (docs/terminal-map.md §3.4).

One `orbits_distances` call per star system that has nodes (3 calls today). The raw envelopes
are stored in raw/<version>/orbits_distances.jsonl, which `mapbuild.load_orbit_rows` reads, so the
compile stays offline. Calls are only made with an explicit confirmation; the plan is free.
"""

from __future__ import annotations

import json
import time
import urllib.request
from collections import defaultdict
from pathlib import Path
from typing import Callable

from nodes import build, load_snapshot

BASE_URL = "https://api.uexcorp.uk/2.0/"
USER_AGENT = "sc-hauling-companion-terminal-map/0.1"
REQUEST_SPACING_S = 0.7
FILE_NAME = "orbits_distances.jsonl"

Get = Callable[[str], dict]


def http_get(path: str) -> dict:
    request = urllib.request.Request(BASE_URL + path, headers={"Accept": "application/json", "User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=30) as response:
        body = json.load(response)
    time.sleep(REQUEST_SPACING_S)
    return body


def plan(raw_dir: Path, version: str) -> list[str]:
    """The requests the step makes: one per star system with nodes, sorted by system id."""
    _, nodes, *_ = build(load_snapshot(raw_dir, version), None)
    systems = sorted({node["system"] for node in nodes.values()})
    return [f"orbits_distances?id_star_system_origin={s}&id_star_system_destination={s}" for s in systems]


def missing_pairs(raw_dir: Path, version: str, responses: list[dict]) -> dict[int, int]:
    """Per star system: how many node-orbit pairs the responses do not cover (either direction)."""
    _, nodes, *_ = build(load_snapshot(raw_dir, version), None)
    orbits: dict[int, set[int]] = defaultdict(set)
    for node in nodes.values():
        if node["orbit"]:
            orbits[node["system"]].add(node["orbit"])
    covered: set[frozenset[int]] = set()
    for response in responses:
        for row in response["data"]:
            covered.add(frozenset((int(row["id_orbit_origin"]), int(row["id_orbit_destination"]))))
    result = {}
    for system, ids in sorted(orbits.items()):
        ordered = sorted(ids)
        gaps = sum(
            1 for i, a in enumerate(ordered) for b in ordered[i + 1 :] if frozenset((a, b)) not in covered
        )
        result[system] = gaps
    return result


def fetch(raw_dir: Path, version: str, get: Get = http_get) -> tuple[Path, dict[int, int]]:
    """Make the planned requests once and store the raw envelopes. Refuses to run twice."""
    out = raw_dir / version / FILE_NAME
    if out.exists():
        raise FileExistsError(f"{out} exists: the distances of {version} were already fetched")
    requests = plan(raw_dir, version)
    lines, responses = [], []
    for path in requests:
        body = get(path)
        if body.get("status") != "ok" or not isinstance(body.get("data"), list) or not body["data"]:
            raise RuntimeError(f"{path}: unusable response (status {body.get('status')!r})")
        responses.append(body)
        lines.append(json.dumps({"request": path, "response": body}, sort_keys=True, separators=(",", ":")))
    out.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")  # only after every call worked
    return out, missing_pairs(raw_dir, version, responses)
