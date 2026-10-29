"""Terminal map compiler (phase 1: node list + request plan, no distance calls).

Builds the node list (one node per planet / moon / space station, see docs/terminal-map.md)
from the UEX metadata endpoints and prints the distance requests a compilation would need.
Only metadata endpoints are ever requested. The distance endpoints are blocked in
`uex_get`; phase 2 lifts that guard.

Usage (Docker only, see docker-compose.yml):
    docker compose run --rm terminal-map --dry-run
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.request
from collections import defaultdict
from pathlib import Path

BASE_URL = "https://api.uexcorp.uk/2.0/"
META_ENDPOINTS = (
    "star_systems",
    "planets",
    "moons",
    "space_stations",
    "orbits",
    "jump_points",
    "terminals",
)
DISTANCE_ENDPOINTS = ("terminals_distances", "orbits_distances")
RATE_LIMIT_PER_MIN = 120
USER_AGENT = "sc-hauling-companion-terminal-map/0.1"
REQUEST_SPACING_S = 0.7


def uex_get(path: str):
    """GET a UEX endpoint and return the envelope's `data`. Metadata endpoints only."""
    name = path.split("?", 1)[0].strip("/")
    if name in DISTANCE_ENDPOINTS or (name != "game_versions" and name not in META_ENDPOINTS):
        raise RuntimeError(f"phase 1 never requests '{name}'")
    request = urllib.request.Request(
        BASE_URL + path, headers={"Accept": "application/json", "User-Agent": USER_AGENT}
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        body = json.load(response)
    if body.get("status") != "ok":
        raise RuntimeError(f"{path}: {body.get('status')} {body.get('message')}")
    time.sleep(REQUEST_SPACING_S)
    return body["data"]


def load_metadata(cache_dir: Path) -> tuple[str, dict[str, list[dict]]]:
    """Return (live game version, endpoint -> records); raw data is cached per game version."""
    version = uex_get("game_versions")["live"]
    meta_dir = cache_dir / version / "meta"
    meta_dir.mkdir(parents=True, exist_ok=True)
    data: dict[str, list[dict]] = {}
    for name in META_ENDPOINTS:
        file = meta_dir / f"{name}.json"
        if file.exists():
            data[name] = json.loads(file.read_text(encoding="utf-8"))
        else:
            data[name] = uex_get(name)
            file.write_text(json.dumps(data[name], sort_keys=True, separators=(",", ":")), encoding="utf-8")
    return version, data


def build(data: dict[str, list[dict]], types: set[str] | None):
    """Nodes per star system plus the jump-point edges between gateway nodes."""
    systems = {s["id"]: s for s in data["star_systems"] if s["is_available_live"]}
    names = {
        "station": {r["id"]: r["name"] for r in data["space_stations"]},
        "moon": {r["id"]: r["name"] for r in data["moons"]},
        "planet": {r["id"]: r["name"] for r in data["planets"]},
        "orbit": {r["id"]: r["name"] for r in data["orbits"]},
    }
    orbit_ids = {r["id"] for r in data["orbits"]}
    orbit_of = {
        "station": {r["id"]: r["id_orbit"] for r in data["space_stations"]},
        "moon": {r["id"]: r["id_orbit"] for r in data["moons"]},  # a moon shares its planet's orbit
        "planet": {r["id"]: r["id"] for r in data["planets"] if r["id"] in orbit_ids},
        "orbit": {i: i for i in orbit_ids},
    }
    terminals = [
        t
        for t in data["terminals"]
        if t["is_available_live"] and t["is_visible"] and (types is None or t["type"] in types)
    ]

    nodes: dict[str, dict] = {}
    unaddressable: list[dict] = []
    for t in sorted(terminals, key=lambda t: t["id"]):
        if t["id_space_station"]:
            kind, ref = "station", t["id_space_station"]
        elif t["id_moon"]:
            kind, ref = "moon", t["id_moon"]
        elif t["id_planet"]:
            kind, ref = "planet", t["id_planet"]
        elif t["id_orbit"]:
            kind, ref = "orbit", t["id_orbit"]
        else:
            unaddressable.append(t)
            continue
        node_id = f"{kind}:{ref}"
        node = nodes.setdefault(
            node_id,
            {
                "id": node_id,
                "system": t["id_star_system"],
                "kind": kind,
                "name": names[kind].get(ref, t["displayname"]),
                # taken from the node's own record: terminal rows can carry a wrong orbit
                # (Chawla's Beach is on Pyro IV, its terminals say orbit Pyro V)
                "orbit": orbit_of[kind].get(ref, t["id_orbit"]),
                "terminals": [],
                "types": set(),
            },
        )
        node["terminals"].append(t["id"])
        node["types"].add(t["type"])
        if t["id_star_system"] != node["system"]:
            raise RuntimeError(f"node {node_id} spans several star systems")

    stations = {s["id"]: s for s in data["space_stations"]}
    station_by_orbit = {s["id_orbit"]: s["id"] for s in stations.values() if s["is_jump_point"]}
    edges: dict[tuple[str, str], dict] = {}
    for jp in data["jump_points"]:
        a = station_by_orbit.get(jp["id_orbit_origin"])
        b = station_by_orbit.get(jp["id_orbit_destination"])
        ends = {jp["id_star_system_origin"], jp["id_star_system_destination"]}
        if a is None or b is None or not ends <= systems.keys():
            continue
        pair = tuple(sorted((f"station:{a}", f"station:{b}")))
        edge = edges.setdefault(pair, {"a": pair[0], "b": pair[1], "jump_point_ids": []})
        edge["jump_point_ids"].append(jp["id"])
    gateways = {n for pair in edges for n in pair}
    return systems, nodes, unaddressable, sorted(edges.values(), key=lambda e: (e["a"], e["b"])), gateways


def plan_requests(system_nodes: list[dict], scheme: str, gateways: set[str]) -> list[tuple[dict, dict]]:
    """Distance requests (origin node, destination node) for one star system."""
    ordered = sorted(system_nodes, key=lambda n: n["id"])
    n = len(ordered)
    if scheme == "orbit":
        # one representative node per distinct orbit; nodes sharing an orbit are not separable
        # (orbit 0 = no orbit record: such a node stays on its own)
        seen: dict[int | str, dict] = {}
        for node in ordered:
            seen.setdefault(node["orbit"] or node["id"], node)
        ordered = list(seen.values())
        scheme = "full"
    if scheme == "full":
        return [(a, b) for i, a in enumerate(ordered) for b in ordered[i + 1 :]]
    if scheme == "landmark":
        landmarks = [x for x in ordered if x["id"] in gateways or x["kind"] == "planet"]
        if n <= 8 or len(landmarks) >= n:
            return [(a, b) for i, a in enumerate(ordered) for b in ordered[i + 1 :]]
        ids = {x["id"] for x in landmarks}
        pairs = [(a, b) for i, a in enumerate(landmarks) for b in landmarks[i + 1 :]]
        pairs += [(a, b) for a in landmarks for b in ordered if b["id"] not in ids]
        return pairs
    raise ValueError(scheme)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    parser.add_argument("--dry-run", action="store_true", help="print the node list and request plan only")
    parser.add_argument("--cache-dir", type=Path, default=Path(__file__).parent / "cache")
    parser.add_argument("--types", default="", help="comma separated terminal types, default: all")
    parser.add_argument("--rate", type=int, default=90, help="planned requests per minute (limit 120)")
    parser.add_argument("--plan-out", type=Path, help="write the full request list (JSON lines) here")
    args = parser.parse_args()
    if not args.dry_run:
        print("Phase 1 only supports --dry-run: no distance endpoint is called.", file=sys.stderr)
        return 2

    types = {t for t in args.types.split(",") if t} or None
    version, data = load_metadata(args.cache_dir)
    systems, nodes, unaddressable, edges, gateways = build(data, types)

    print(f"game version {version}, terminal types: {sorted(types) if types else 'all'}")
    print(f"unaddressable terminals (no station/moon/planet/orbit): {len(unaddressable)}")
    for t in unaddressable:
        print(f"  - {t['id']} {t['name']} ({t['type']})")
    print("jump edges (gateway station nodes):")
    for e in edges:
        print(f"  {e['a']} <-> {e['b']}  jump_points {e['jump_point_ids']}")

    by_system: dict[int, list[dict]] = defaultdict(list)
    for node in nodes.values():
        by_system[node["system"]].append(node)

    totals = defaultdict(int)
    plan_lines: list[str] = []
    for system_id in sorted(by_system):
        members = by_system[system_id]
        kinds = defaultdict(int)
        for m in members:
            kinds[m["kind"]] += 1
        orbit_groups = len({m["orbit"] or m["id"] for m in members})
        print(f"\n{systems[system_id]['name']}: {len(members)} nodes {dict(sorted(kinds.items()))}, {orbit_groups} distinct orbits")
        print(f"  gateways: {sorted(m['id'] + ' ' + m['name'] for m in members if m['id'] in gateways)}")
        for m in sorted(members, key=lambda m: (m["orbit"], m["id"])):
            print(
                f"    {m['id']:<14} {m['name']:<42} orbit {m['orbit']:<4} "
                f"{len(m['terminals']):>2} term. {','.join(sorted(m['types']))}"
            )
        for scheme in ("full", "orbit", "landmark"):
            requests = plan_requests(members, scheme, gateways)
            totals[scheme] += len(requests)
            print(f"  {scheme:8s} {len(requests):5d} calls")
            if scheme == "full":
                for a, b in requests:
                    plan_lines.append(
                        json.dumps(
                            {"origin": a["terminals"][0], "destination": b["terminals"][0], "nodes": [a["id"], b["id"]]},
                            sort_keys=True,
                        )
                    )
    print("\nTotals (unordered pairs; double them if the endpoint turns out to be asymmetric):")
    for scheme in ("full", "orbit", "landmark"):
        calls = totals[scheme]
        print(f"  {scheme:8s} {calls:5d} calls ≈ {calls / args.rate:5.1f} min at {args.rate} req/min")
    print(f"  (limit {RATE_LIMIT_PER_MIN} req/min; metadata fetches for this run: {len(META_ENDPOINTS) + 1})")
    if args.plan_out:
        args.plan_out.write_text("\n".join(plan_lines) + "\n", encoding="utf-8")
        print(f"full-matrix request list written to {args.plan_out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
