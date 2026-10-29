"""Terminal map compiler (phase 1: node list + request plan, no distance calls).

Builds the node list (one node per planet / moon / space station, see docs/terminal-map.md)
from the UEX metadata endpoints and prints the distance requests a compilation would need.
Only metadata endpoints are requested, plus the fixed 8-request `--probe` list. The distance
endpoints are blocked in `uex_get`.

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
SCHEMES = ("full", "routing", "orbit", "routing+orbit", "landmark")


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


# The only distance requests this tool can make so far (docs/terminal-map.md §7): a fixed list.
PROBE_REQUESTS = (
    "orbits_distances?id_star_system_origin=68&id_star_system_destination=68",
    "orbits_distances?id_star_system_origin=64&id_star_system_destination=64",
    "orbits_distances?id_star_system_origin=55&id_star_system_destination=55",
    "terminals_distances?id_terminal_origin=18&id_terminal_destination=12",  # Lorville -> Area18
    "terminals_distances?id_terminal_origin=12&id_terminal_destination=18",  # Area18 -> Lorville
    "terminals_distances?id_terminal_origin=18&id_terminal_destination=28",  # Lorville -> Aberdeen
    "terminals_distances?id_terminal_origin=28&id_terminal_destination=12",  # Aberdeen -> Area18
    "terminals_distances?id_terminal_origin=25&id_terminal_destination=12",  # Everus Harbor -> Area18
)


RAW_DIR = Path(__file__).parent / "raw"  # raw distance responses: committed, the compiler's input


def probe() -> int:
    """Run the fixed probe list once; raw envelopes go to raw/<version>/probe.jsonl."""
    version = uex_get("game_versions")["live"]
    out = RAW_DIR / version / "probe.jsonl"
    if out.exists():
        print(f"{out} exists: the probe already ran, not repeating it")
        return 1
    out.parent.mkdir(parents=True, exist_ok=True)
    lines = []
    for path in PROBE_REQUESTS:
        request = urllib.request.Request(
            BASE_URL + path, headers={"Accept": "application/json", "User-Agent": USER_AGENT}
        )
        with urllib.request.urlopen(request, timeout=30) as response:
            body = json.load(response)
        lines.append(json.dumps({"request": path, "response": body}, sort_keys=True, separators=(",", ":")))
        data = body.get("data")
        size = len(data) if isinstance(data, list) else 1
        print(f"{path}\n  status={body.get('status')} http={body.get('http_code')} records={size}")
        time.sleep(REQUEST_SPACING_S)
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"raw responses written to {out}")
    return 0


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
        if t["type"] == "commodity" and "rep" not in node:
            node["rep"] = t["id"]  # request representative: first commodity terminal ...
        if t["id_star_system"] != node["system"]:
            raise RuntimeError(f"node {node_id} spans several star systems")
    for node in nodes.values():
        node.setdefault("rep", node["terminals"][0])  # ... else the lowest terminal id

    # Nodes without an orbit record (the three Wikelo Emporium stations) are ignored.
    ignored = [n for n in nodes.values() if n["orbit"] == 0]
    for node in ignored:
        del nodes[node["id"]]

    # Planetary group: a planet with its moons and stations (Lagrange points, Everus Harbor, ...).
    # Nodes without a parent planet (gateways, Nyx stations, Delamar) stand alone.
    parent_planet = {
        "station": {r["id"]: r["id_planet"] for r in data["space_stations"]},
        "moon": {r["id"]: r["id_planet"] for r in data["moons"]},
        "planet": {r["id"]: r["id"] for r in data["planets"]},
        "orbit": {},
    }
    for node in nodes.values():
        planet = parent_planet[node["kind"]].get(int(node["id"].split(":")[1]), 0)
        node["parent"] = f"planet:{planet}" if planet and f"planet:{planet}" in nodes else None

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
    return (
        systems,
        nodes,
        unaddressable,
        sorted(edges.values(), key=lambda e: (e["a"], e["b"])),
        gateways,
        ignored,
    )


def is_entry(node: dict) -> bool:
    """Reachable directly from outside its group: a planet, or a node without a parent planet."""
    return node["parent"] is None or node["parent"] == node["id"]


def routing_pairs(ordered: list[dict]) -> list[tuple[dict, dict]]:
    """The pairs the travel rules need (docs/terminal-map.md §2.5):
    entry-entry, every node to every entry (leaving a group works from anywhere), and the
    members of one group among each other. Child-to-child across groups is never needed,
    because arriving at a child goes through its planet."""
    entries = [n for n in ordered if is_entry(n)]
    pairs = [(a, b) for i, a in enumerate(entries) for b in entries[i + 1 :]]
    pairs += [(c, e) for c in ordered if not is_entry(c) for e in entries]
    children = [n for n in ordered if not is_entry(n)]
    pairs += [(a, b) for i, a in enumerate(children) for b in children[i + 1 :] if a["parent"] == b["parent"]]
    return pairs


def plan_requests(system_nodes: list[dict], scheme: str, gateways: set[str]) -> list[tuple[dict, dict]]:
    """Distance requests (origin node, destination node) for one star system."""
    ordered = sorted(system_nodes, key=lambda n: n["id"])
    n = len(ordered)
    if scheme in ("routing", "routing+orbit"):
        pairs = routing_pairs(ordered)
        if scheme == "routing":
            return pairs
        # H1: nodes sharing an orbit are one point for the API. Use one request node per
        # orbit (entries first), drop self pairs and duplicates.
        rep: dict[int | str, dict] = {}
        for node in sorted(ordered, key=lambda x: (not is_entry(x), x["id"])):
            rep.setdefault(node["orbit"], node)
        unique: dict[tuple[str, str], tuple[dict, dict]] = {}
        for a, b in pairs:
            ra, rb = rep[a["orbit"]], rep[b["orbit"]]
            if ra["id"] != rb["id"]:
                unique.setdefault(tuple(sorted((ra["id"], rb["id"]))), (ra, rb))
        return list(unique.values())
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
    parser.add_argument("--probe", action="store_true", help="send the 8 fixed probe requests (once)")
    parser.add_argument("--cache-dir", type=Path, default=Path(__file__).parent / "cache")
    parser.add_argument("--types", default="", help="comma separated terminal types, default: all")
    parser.add_argument("--rate", type=int, default=90, help="planned requests per minute (limit 120)")
    parser.add_argument("--scheme", choices=SCHEMES, default="routing", help="scheme --plan-out writes")
    parser.add_argument("--plan-out", type=Path, help="write the request list (JSON lines) here")
    args = parser.parse_args()
    if args.probe:
        return probe()
    if not args.dry_run:
        print("Only --dry-run and --probe (8 fixed requests) are supported so far.", file=sys.stderr)
        return 2

    types = {t for t in args.types.split(",") if t} or None
    version, data = load_metadata(args.cache_dir)
    systems, nodes, unaddressable, edges, gateways, ignored = build(data, types)

    print(f"game version {version}, terminal types: {sorted(types) if types else 'all'}")
    print(f"unaddressable terminals (no station/moon/planet/orbit): {len(unaddressable)}")
    for t in unaddressable:
        print(f"  - {t['id']} {t['name']} ({t['type']})")
    print(f"ignored nodes (no orbit record): {[n['name'] for n in ignored]}")
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
        for m in sorted(members, key=lambda m: (m["parent"] or m["id"], not is_entry(m), m["id"])):
            print(
                f"    {m['id']:<14} {m['name']:<42} orbit {m['orbit']:<4} "
                f"group {m['parent'] or '-':<11} {len(m['terminals']):>2} term. {','.join(sorted(m['types']))}"
            )
        entries = sum(1 for m in members if is_entry(m))
        print(f"  entries {entries}, group members {len(members) - entries}")
        for scheme in SCHEMES:
            requests = plan_requests(members, scheme, gateways)
            totals[scheme] += len(requests)
            print(f"  {scheme:14s} {len(requests):5d} calls")
            if scheme == args.scheme:
                for a, b in requests:
                    plan_lines.append(
                        json.dumps(
                            {"origin": a["rep"], "destination": b["rep"], "nodes": [a["id"], b["id"]]},
                            sort_keys=True,
                        )
                    )
    print("\nTotals (unordered pairs; double them if the endpoint turns out to be asymmetric):")
    for scheme in SCHEMES:
        calls = totals[scheme]
        print(f"  {scheme:14s} {calls:5d} calls ≈ {calls / args.rate:5.1f} min at {args.rate} req/min")
    print(f"  (limit {RATE_LIMIT_PER_MIN} req/min; metadata fetches for this run: {len(META_ENDPOINTS) + 1})")
    if args.plan_out:
        args.plan_out.write_text("\n".join(plan_lines) + "\n", encoding="utf-8")
        print(f"'{args.scheme}' request list written to {args.plan_out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
