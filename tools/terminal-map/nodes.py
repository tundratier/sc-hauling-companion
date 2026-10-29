"""Node list for the terminal map: one node per planet / moon / space station.

Reads the trimmed metadata snapshot (raw/<version>/metadata.json) and builds the nodes, the
planetary groups and the jump edges. See docs/terminal-map.md §2.
"""

from __future__ import annotations

import json
from pathlib import Path

META_ENDPOINTS = (
    "star_systems",
    "planets",
    "moons",
    "space_stations",
    "orbits",
    "jump_points",
    "terminals",
)

# The fields the compiler reads; everything else is dropped from the committed snapshot.
META_FIELDS = {
    "star_systems": ("id", "name", "is_available_live"),
    "planets": ("id", "name", "id_star_system"),
    "moons": ("id", "name", "id_planet", "id_orbit", "id_star_system"),
    "space_stations": ("id", "name", "id_planet", "id_moon", "id_orbit", "id_star_system", "is_jump_point"),
    "orbits": ("id", "name", "id_star_system"),
    "jump_points": (
        "id",
        "id_star_system_origin",
        "id_star_system_destination",
        "id_orbit_origin",
        "id_orbit_destination",
    ),
    "terminals": (
        "id",
        "name",
        "displayname",
        "type",
        "id_star_system",
        "id_planet",
        "id_moon",
        "id_space_station",
        "id_orbit",
        "is_available_live",
        "is_visible",
    ),
}


def trim(endpoint: str, records: list[dict]) -> list[dict]:
    fields = META_FIELDS[endpoint]
    return sorted(({f: r[f] for f in fields} for r in records), key=lambda r: r["id"])


def snapshot_path(raw_dir: Path, version: str) -> Path:
    return raw_dir / version / "metadata.json"


def load_snapshot(raw_dir: Path, version: str) -> dict[str, list[dict]]:
    return json.loads(snapshot_path(raw_dir, version).read_text(encoding="utf-8"))


def write_snapshot(raw_dir: Path, version: str, data: dict[str, list[dict]]) -> Path:
    path = snapshot_path(raw_dir, version)
    path.parent.mkdir(parents=True, exist_ok=True)
    trimmed = {name: trim(name, data[name]) for name in META_ENDPOINTS}
    path.write_text(json.dumps(trimmed, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8")
    return path

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
