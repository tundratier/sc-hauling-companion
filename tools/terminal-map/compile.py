"""Terminal map compiler (docs/terminal-map.md).

    --compile   build src/data/terminalMap/<version>.json from the committed raw files (offline)
    --check     recompile and fail if the committed file differs (determinism check, offline)
    --snapshot  store the trimmed metadata of a game version in raw/<version>/metadata.json
    --fetch     plan the 3 orbits_distances calls of a game version; with --confirm make them
    --dry-run   print the node list and the distance-request plans of the (older) pair schemes
    --probe     the 8 fixed probe requests (already run once for 4.10.2)

`--compile` and `--check` never touch the network. The distance endpoints are blocked in
`uex_get`; only `--probe` may request them, from a fixed list.

Usage (Docker only, see docker-compose.yml):
    docker compose run --rm terminal-map --compile
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.request
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # `python -I` drops the script dir

from nodes import META_ENDPOINTS, build, is_entry, load_snapshot, write_snapshot  # noqa: E402

BASE_URL = "https://api.uexcorp.uk/2.0/"
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


RAW_DIR = Path(__file__).parent / "raw"  # raw responses + metadata snapshot: committed, the input
OUT_DIR = Path(__file__).resolve().parents[2] / "src" / "data" / "terminalMap"


def newest_version() -> str:
    def key(name: str) -> tuple:
        return tuple(int(p) if p.isdigit() else 0 for p in name.replace("a", ".0").split("."))

    versions = [p.name for p in RAW_DIR.iterdir() if p.is_dir()]
    if not versions:
        raise SystemExit(f"no raw data in {RAW_DIR}")
    return max(versions, key=key)


def snapshot(cache_dir: Path, version: str | None) -> int:
    """Trimmed metadata -> raw/<version>/metadata.json (uses the local cache files if present)."""
    version = version or uex_get("game_versions")["live"]
    data: dict[str, list[dict]] = {}
    for name in META_ENDPOINTS:
        file = cache_dir / version / "meta" / f"{name}.json"
        data[name] = json.loads(file.read_text(encoding="utf-8")) if file.exists() else uex_get(name)
    print(f"wrote {write_snapshot(RAW_DIR, version, data)}")
    return 0


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

def fetch_distances(version: str | None, confirm: bool) -> int:
    """New game version: one orbits_distances call per star system (needs raw/<version>/metadata.json)."""
    import fetch

    version = version or uex_get("game_versions")["live"]
    if not (RAW_DIR / version / "metadata.json").exists():
        print(f"no snapshot for {version}: run --snapshot --game-version {version} first")
        return 1
    requests = fetch.plan(RAW_DIR, version)
    print(f"game version {version}: {len(requests)} calls")
    for path in requests:
        print(f"  {path}")
    if not confirm:
        print("nothing sent; add --confirm to make these calls")
        return 0
    out, gaps = fetch.fetch(RAW_DIR, version)
    print(f"raw responses written to {out}")
    for system, count in gaps.items():
        print(f"  star system {system}: {count} node-orbit pairs without a distance")
    print(f"next: --compile --game-version {version}")
    return 0


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
    parser.add_argument("--dry-run", action="store_true", help="print the node list and request plans only")
    parser.add_argument("--probe", action="store_true", help="send the 8 fixed probe requests (once)")
    parser.add_argument("--compile", action="store_true", help="write the map data file (offline)")
    parser.add_argument("--check", action="store_true", help="fail if the committed map data differs (offline)")
    parser.add_argument("--snapshot", action="store_true", help="store the trimmed metadata in raw/")
    parser.add_argument("--fetch", action="store_true", help="plan the orbits_distances calls of a game version")
    parser.add_argument("--confirm", action="store_true", help="with --fetch: really make the calls (needs a go-ahead)")
    parser.add_argument("--game-version", help="default: the newest version in raw/")
    parser.add_argument("--out-dir", type=Path, default=OUT_DIR, help="where the map data files live")
    parser.add_argument("--cache-dir", type=Path, default=Path(__file__).parent / "cache")
    parser.add_argument("--types", default="", help="comma separated terminal types, default: all")
    parser.add_argument("--rate", type=int, default=90, help="planned requests per minute (limit 120)")
    parser.add_argument("--scheme", choices=SCHEMES, default="routing", help="scheme --plan-out writes")
    parser.add_argument("--plan-out", type=Path, help="write the request list (JSON lines) here")
    args = parser.parse_args()
    if args.probe:
        return probe()
    if args.snapshot:
        return snapshot(args.cache_dir, args.game_version)
    if args.fetch:
        return fetch_distances(args.game_version, args.confirm)
    if args.compile or args.check:
        import mapbuild

        version = args.game_version or newest_version()
        text = mapbuild.compile_version(RAW_DIR, version)
        target = args.out_dir / f"{version}.json"
        if args.check:
            same = target.exists() and target.read_text(encoding="utf-8", newline="") == text
            print(f"{target}: {'identical' if same else 'DIFFERS from a fresh compile'}")
            return 0 if same else 1
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8", newline="")
        print(f"wrote {target} ({len(text)} bytes)")
        return 0
    if not args.dry_run:
        parser.print_usage(sys.stderr)
        return 2

    types = {t for t in args.types.split(",") if t} or None
    version = args.game_version or newest_version()
    data = load_snapshot(RAW_DIR, version)
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
