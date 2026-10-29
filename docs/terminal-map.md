# Terminal map — design and distance-call analysis (phase 1)

Status: phase 1 (research and design), revision 2 · Written: 2026-10-29 · Game version analysed: Star Citizen LIVE 4.10.2

Goal: a deterministic, pre-compiled 2D map of terminal locations, computed with MDS from UEX distance data and imported by the app like the caches in `src/api/`. Later uses (the data is designed for them, nothing is built yet): distance between two terminals, terminals along a route, drawing the graph.

**No distance endpoint has been called.** Phase 1 made ~25 requests to metadata endpoints (`game_versions`, `star_systems`, `planets`, `moons`, `space_stations`, `orbits`, `jump_points`, `terminals`, plus `cities` and `outposts` for inspection) and read the endpoint documentation.

### Revision 2 — product owner decisions (2026-10-29)

1. The map is a **good-enough representation**: travel-time differences are ignored (loading cargo dominates). All distances are **straight lines**, and one terminal per node stands for the whole node (all terminals at Cellin share the distances of the Cellin node).
2. A gateway station is an ordinary node of the graph, so `A → gateway → B` routes exist. Jump points connect gateway stations. (Revision 1 called Terra Gateway a "dead end"; that only meant it has no partner gateway in this game version.)
3. **Wikelo Emporium stations are ignored.**
4. A jump costs a **constant ~70 Gm**.
5. If the API cannot tell moon terminals from planet terminals, **spread the moons 0.15 Gm** around the planet.
6. **Travel rule:** from outside a planetary system you can only travel to its planet, and from there to its moons and stations. A planetary system can be left from any location in it (§2.5).
7. Whether `orbits_distances` is complete is not known (stays an open question).

## 1. Distance endpoints

Docs: <https://uexcorp.space/api/documentation>. There are two endpoints, both public (no key), GET, JSON envelope as in SPEC §4.

### 1.1 `GET /terminals_distances` — terminal ↔ terminal, one pair per call

`terminals_distances?id_terminal_origin={int}&id_terminal_destination={int}` · cache TTL 12 h · "estimates the distance between two terminals". Both parameters are required (`missing_id_terminal_origin` / `missing_id_terminal_destination` are the only error statuses).

Documented response fields (the docs give no example; SPEC §4 already records that `distance` can arrive as a numeric string such as `"6"`, so coerce with `Number()`):

| Field | Type | Meaning |
|---|---|---|
| `distance` | float | **gigameters (Gm)** |
| `terminal_name_origin/destination`, `terminal_nickname_*`, `terminal_code_*` | string | echo of the two terminals |
| `orbit_name_origin/destination` | string \| null | the orbit each terminal belongs to |

Expected shape (assembled from the field list, **not yet observed**; `data` may be one object or a one-element array, so the mapper must accept both):

```json
{ "status": "ok", "http_code": 200, "message": "",
  "data": { "terminal_name_origin": "Admin - ARC-L1", "terminal_nickname_origin": "ARC-L1",
            "terminal_code_origin": "ARCL1", "orbit_name_origin": "ArcCorp Lagrange Point 1",
            "terminal_name_destination": "...", "terminal_nickname_destination": "...",
            "terminal_code_destination": "...", "orbit_name_destination": "...",
            "distance": "6" } }
```

So one request returns **one pair, terminal to terminal**. There is no "all destinations from one origin" form. The response echoes the *orbit* of each terminal and not a body, which suggests the distance is derived from orbit-to-orbit data (hypothesis **H1**, §6).

### 1.2 `GET /orbits_distances` — orbit ↔ orbit, possibly many pairs per call

`orbits_distances?id_star_system_origin={int}&id_star_system_destination={int}[&id_orbit_origin={int}&id_orbit_destination={int}]` (the old `id_star_system` is deprecated) · cache TTL 1 day · "the last orbital distances reported by Datarunners".

Response: a list of records `{id, id_star_system_origin, id_star_system_destination, id_orbit_origin, id_orbit_destination, distance (Gm), game_version, date_added, date_modified, *_name…}`. The orbit ids are optional filters, so **one call without them can return every reported orbit pair of a system pair**. Whether the list is complete or sparse (only pairs Datarunners reported) is **unknown** and cannot be seen without calling it. Orbits are planets, Lagrange points, stations, gateways and asteroids; **moons have no orbit of their own** (a moon's `id_orbit` is its planet's), so this endpoint cannot separate a planet from its moons. The game version tag in each row is useful for caching.

If it is complete, the compilation is ~3 calls (§3.2). That is the first thing to verify in phase 2.

Not used for distances: `jump_points` (metadata, no length), `commodities_routes`.

## 2. Nodes, groups and the travel graph (real metadata, game 4.10.2)

### 2.1 Node rules

- Scope: terminals with `is_available_live && is_visible`, **all terminal types** (754 terminals; 114 are commodity terminals, the set the app uses). `--types commodity` restricts it (then a planet that only has non-commodity terminals loses its node; the figures below are for all types).
- Node key, first match wins: `id_space_station` → `station:<id>`; `id_moon` → `moon:<id>`; `id_planet` → `planet:<id>`; `id_orbit` → `orbit:<id>`. So a city or outpost belongs to its moon or planet, a space station is always its own node (also Lagrange and gateway stations), and Levski (a city on the asteroid Delamar, no planet) is `orbit:325`.
- Node name comes from the `moons` / `planets` / `space_stations` / `orbits` record, not from a terminal's `displayname` (not unique).
- A node's orbit is read from its own record (planet id = orbit id, `moon.id_orbit` = the planet's orbit, `station.id_orbit`), **not** from the terminal rows: terminal rows can be wrong (Chawla's Beach is on Pyro IV, its terminals say orbit Pyro V).
- Request representative per node: its first commodity terminal if it has one, otherwise the lowest terminal id. Every member terminal id is stored.
- **Ignored:** nodes without an orbit record, i.e. the Wikelo Emporium Kinga / Dasi / Selo stations (one fuel terminal each). Also dropped: terminal 725 (Covalex Distribution Centre S4DC05, fuel) and 792 (NovaworX ORISON, item): no location ids at all (792 clearly belongs to Orison; neither is a commodity terminal).

### 2.2 Nodes per system

| System | Nodes | planet | moon | station | orbit | Distinct orbits | Entry nodes | Group members |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Stanton | **42** | 4 | 12 | 26 | 0 | 25 | 7 | 35 |
| Pyro | **22** | 6 | 3 | 13 | 0 | 17 | 8 | 14 |
| Nyx | **7** | 0 | 0 | 6 | 1 | 7 | 7 | 0 |
| **Total** | **71** | 10 | 15 | 45 | 1 | 49 | 22 | 49 |

(`docker compose run --rm terminal-map --dry-run` prints every node with its group. Only Stanton, Pyro and Nyx are live; the other 93 star systems in UEX are not available.)

- **Stanton** — planets ArcCorp, Crusader, Hurston, MicroTech; moons Aberdeen, Arial, Ita, Magda (Hurston), Calliope, Clio, Euterpe (MicroTech), Cellin, Daymar, Yela (Crusader), Lyria, Wala (ArcCorp); stations ARC-L1…L5, CRU-L1/L4/L5, HUR-L1…L5, MIC-L1…L5, Baijini Point, Everus Harbor, Port Tressler, Seraphim Station, Green Imperial Housing Exchange (Grim HEX), Pyro Gateway, Nyx Gateway, Terra Gateway.
- **Pyro** — planets Pyro I, Monox, Bloom, Pyro IV, Pyro V, Terminus; moons Adir, Ignis, Vatra; stations Orbituary, Ruin Station, Endgame, Megumi Refueling, Patch City, Gaslight, Rod's Fuel 'N Supplies, Rat's Nest, Dudley & Daughters, Checkmate Station, Starlight Service Station, Stanton Gateway, Nyx Gateway.
- **Nyx** — Delamar (Levski), People's Service Station Alpha/Delta/Lambda/Theta, Stanton Gateway, Pyro Gateway.

### 2.3 Jump points and gateways

`jump_points` has 6 rows (directional, 3 pairs). Each end is an orbit that is also a gateway *station* (`is_jump_point = 1`), which is the "jump point connects only to its gateway station" rule. Gateway stations are ordinary nodes with ordinary terminals:

| Jump | Gateway station A | Gateway station B | `jump_points` ids |
|---|---|---|---|
| Stanton ↔ Pyro | `station:24` Pyro Gateway (Stanton) | `station:50` Stanton Gateway (Pyro) | 1, 2 |
| Pyro ↔ Nyx | `station:55` Nyx Gateway (Pyro) | `station:57` Pyro Gateway (Nyx) | 3, 6 |
| Nyx ↔ Stanton | `station:56` Stanton Gateway (Nyx) | `station:25` Nyx Gateway (Stanton) | 4, 5 |

Two things differ from a pure tree:

1. **The three systems form a triangle**: every pair is linked, so a cross-system route has two candidate paths (direct, or through the third system). Shortest path decides.
2. **Terra Gateway (Stanton)** (`station:26`, 19 terminals, one commodity terminal) is a normal Stanton node, reachable like any gateway, but UEX has no `jump_points` row for it (Terra is not a live system), so it has **no jump edge in 4.10.2**. It is listed so a later game version that adds the row only needs a metadata refresh.

### 2.4 Co-orbit nodes

Moons have no orbit of their own, and several stations sit on their planet's orbit (Baijini Point, Everus Harbor, Port Tressler, Seraphim, Green Imperial, Orbituary, Ruin Station). If UEX distances depend on orbits only (H1), such nodes are one point for the API. Stanton has 42 nodes on 25 orbits, Pyro 22 on 17. Display rule in §5.3: **0.15 Gm spread around the planet**.

### 2.5 Travel rules (the routing graph)

A **group** is a planet node with its moons and stations (stations are assigned through `space_stations.id_planet`, moons through `moons.id_planet`; Lagrange stations, Everus Harbor, Grim HEX at Yela belong to their planet). Nodes without a parent planet stand alone: the gateways, the Nyx stations and Delamar. **Entry nodes** are planets and standalone nodes. Per star system the directed graph is (weights are straight-line distances):

| From → to | Allowed | Weight |
|---|---|---|
| entry → entry (any group) | yes | `d` |
| planet ↔ its own moons/stations | yes | `d` |
| member ↔ member of the same group | yes (assumed, not stated; §6 Q8) | `d` |
| any member → entry outside its group | yes ("the system can be left from any location") | `d` |
| entry or member of another group → member | **no** — arrive at the planet first | via the planet |
| gateway ↔ its partner gateway in the other system | yes | **70 Gm** (constant) |

Consequences:

- The graph is directed: Area18 → Aberdeen is `d(Area18, Hurston) + d(Hurston, Aberdeen)`, while Aberdeen → Area18 is the direct `d(Aberdeen, Area18)`. Cross-system routes work through the gateway entry nodes with the same rules, e.g. Cellin → Pyro Gateway (Stanton) → jump 70 → Stanton Gateway (Pyro) → Monox → Checkmate.
- Only **the pairs the rules use must be measured**: entry–entry, every member to every entry, and member–member inside a group. Member-to-member across groups is never needed, which is why the routing scheme in §3 is cheaper than the full matrix.
- The same measured pairs are what the 2D embedding is fitted to; the rules only change how routes are composed from them.

## 3. Distance calls

All numbers: unordered pairs, scope = all 71 nodes (`compile.py --dry-run`). If the endpoint is asymmetric (to be checked, §6) double every figure. Planned rate **90 requests/minute** (75 % of the 120/min limit, ≈ 0.67 s between requests, back-off on 429 / `requests_limit_reached`); the 172,800/day quota is irrelevant.

### 3.1 `terminals_distances` (one pair per call)

| Scheme | Stanton | Pyro | Nyx | Total | At 90 req/min |
|---|---|---|---|---:|---:|
| **Full node matrix** `n(n−1)/2` | 42·41/2 = 861 | 22·21/2 = 231 | 7·6/2 = 21 | **1,113** | 12.4 min |
| **Routing set** (§2.5) = entry–entry + member×entry + member–member in a group | 21 + 35·7 + 137 = **403** | 28 + 14·8 + 21 = **161** | 21 | **585** | 6.5 min |
| Routing set **if H1 holds** (nodes on one orbit are one request point) | 180 | 105 | 21 | **306** | 3.4 min |
| Full matrix if H1 holds, `o(o−1)/2` | 25·24/2 = 300 | 17·16/2 = 136 | 21 | 457 | 5.1 min |
| Landmarks (gateways + planets as anchors), for reference | 15 + 6·36 = 231 | 28 + 8·14 = 140 | 21 | 392 | 4.4 min |
| Jump edges | constant 70 Gm, not measured | | | 0 | |

Routing set details: Stanton has 7 entries (4 planets, 3 gateways) and 35 group members in four groups of 10 (Hurston), 9 (MicroTech), 8 (ArcCorp) and 8 (Crusader) members, so member–member inside groups is 45 + 36 + 28 + 28 = 137. Pyro has 8 entries (6 planets, 2 gateways) and 14 members, intra-group 3 + 15 + 3 = 21. Nyx has 7 standalone nodes, so all pairs (21) are entry–entry.

Cross-system pairs are **never requested**: they follow from the within-system pairs plus the jump edges.

(Commodity-only scope: 69 nodes, a few dozen calls fewer; not tuned.)

### 3.2 `orbits_distances` (if it returns whole pair lists)

| Tier | Calls |
|---|---|
| A — one call per system (`origin = destination = system`) | 3 |

Row counts and completeness are unknown. It cannot separate moons from planets (§1.2), so at best it replaces the "if H1 holds" rows and only for pairs it lists.

### 3.3 What MDS really needs

A 2D embedding of n points is determined by far fewer than n(n−1)/2 distances. The routing set is both what the travel rules need and a robust MDS input: every group member is tied to all 7–8 entry nodes of its system (so its position is well constrained, with 7 distances for 2 unknowns) and to its group. The pairs left out (member to member across groups) are the ones the rules never use. A landmark-only scheme (392 calls) would save only ~3 minutes more and leaves the members of one group loosely tied to each other, so it is not recommended.

### 3.4 Recommendation for the budget

- **Measure the routing set: 585 calls, ≈ 6.5 minutes, once per game version.** It covers everything the routing and the map need.
- If the first responses show H1 (nodes on one orbit return identical distances), switch to the H1 set (306 calls, ≈ 3.4 min) and copy the values to the co-orbit nodes.
- The probe in §7 is a subset of the routing set, so no probe call is wasted.
- If `orbits_distances` turns out to be complete, use it for the entry–entry pairs and the Lagrange stations, and only call `terminals_distances` for the rest.

### 3.5 Caching and later game versions

- Raw responses are stored **one record per terminal pair, append-only** in `tools/terminal-map/raw/<gameVersion>.jsonl` and **committed** (≈ 600 short lines ≈ 120 KB). They are the compiler's only input besides the metadata, so a recompile (algorithm change, new output shape) makes **0 requests**. Metadata responses are cached beside them (`tools/terminal-map/cache/`, git-ignored; 8 cheap requests).
- A pair key is `(origin terminal, destination terminal)` and does not contain the game version. For a new version the compiler diffs the node list and groups: unchanged pairs are copied forward (tagged with the version they were measured in); a **new** node costs one distance per routing partner (a new Stanton station: 7 entries + its group, ≈ 15 calls instead of 585); removed nodes drop out.
- Moved bodies cannot be detected from metadata, so each new version re-measures a deterministic sample (every 15th pair + all pairs of gateway nodes, ≈ 60 calls, under a minute) and recomputes everything if any differs by more than 1 %.
- `terminals_distances` has a 12 h server cache, so retries within a day are free for UEX too.

## 4. Language, tooling and algorithm

### 4.1 Python in a Docker image

**Python** (numpy), not Node:

- Classical MDS is an eigendecomposition and SMACOF is ~25 lines of matrix algebra; `numpy.linalg.eigh` is exactly the tool. The JS ecosystem has no maintained MDS library (only generic matrix packages), so a Node compiler would hand-roll both on top of `ml-matrix`.
- scikit-learn's `MDS` is not needed: it has no weights or missing-value support, which the routing set needs (member pairs across groups are missing), and it drags in scipy. A weighted SMACOF is written directly in numpy.
- The compiler is a build-time tool, not app code. A separate image keeps the app's `package.json` / lockfile clean (SPEC §2: only Docker on the host, satisfied) and the app only imports the JSON output.
- Image: pinned `python:3.13.x-alpine` (`tools/terminal-map/Dockerfile`), pinned numpy in `requirements.txt` when the MDS step arrives. Phase 1 needs the standard library only.

### 4.2 Algorithm (per star system)

1. **Measured pairs** `d_ij` in Gm (the routing set). A pair that comes back as 0 or unusable between nodes on one orbit is replaced by the co-orbit constant 0.15 Gm (§5.3).
2. **Complete the matrix for the start only:** unmeasured pairs are filled with the shortest path over the measured pairs (an upper bound).
3. **Initialization:** classical (Torgerson) MDS: double-centre `−½ J D² J`, `eigh`, two largest eigenpairs. No randomness, no restarts.
4. **Refinement:** weighted SMACOF (stress majorization) from that start. Weight `w_ij = 1 / d_ij` for measured pairs and `0` for filled pairs, so the short member–planet distances are not drowned by planet-to-planet ones. Fixed maximum of 500 iterations, relative tolerance 1e-9. The weighting is tuned once on the measured stress in phase 2 and then fixed in the file's `generator` block.
5. **Why SMACOF on top of classical MDS:** the data is 3D projected to 2D and incomplete. Classical MDS minimises the wrong thing then (it truncates eigenvalues); SMACOF minimises the actual stress on the measured pairs.
6. **Quality metrics** (per system, §5.2): `stress1` (Kruskal stress-1 on measured pairs), mean and max relative pair error, and `planarShare` = (λ₁+λ₂)/Σ positive λ from the classical step (how 2D the system really is).

### 4.3 Determinism

Same input → byte-identical output:

- No randomness anywhere (deterministic init, fixed iteration count). If one is ever introduced it uses `numpy.random.default_rng(0)`.
- **Canonical frame** per system: translate the centroid to 0, rotate to the principal axes (eigenvectors of the coordinate covariance, ordered by eigenvalue), then fix the signs: each axis is flipped so that Σ x·|x| ≥ 0 (ties → smallest node id). That removes MDS's rotation and reflection freedom. Units stay Gm (never normalised), so `‖a − b‖` approximates the distance.
- Stable order: nodes sorted by `(system id, kind rank, numeric id)`, JSON written with sorted keys, compact separators, `\n` line endings, coordinates rounded to 3 decimals (1 Mm) with `-0.0` normalised to `0.0`.
- `OPENBLAS_NUM_THREADS=1`, `PYTHONHASHSEED=0`, base image pinned by digest.
- Float differences between CPU architectures are absorbed by the rounding except for a value on a rounding boundary, so the compiler has **`--check`**: recompile from the committed raw cache and fail if the result differs from the committed file. If it ever flaps, the fallback is a pure-stdlib implementation (Jacobi eigensolver + SMACOF; n ≤ 42, < 1 s, only `+ − × ÷ √`, bit-exact everywhere).

## 5. Output data

### 5.1 File and import

`src/data/terminalMap/<gameVersion>.json` (e.g. `4.10.2.json`) plus an `index.ts` that maps version → lazy `import()`. The app looks up the LIVE version (the `GameVersions` the cache layer already holds) and falls back to the newest older file, marking the map "from 4.10.2". The data is static per version, so it needs no TTL, only the `schemaVersion` check the caches already have. Size ≈ 35 KB.

### 5.2 Shape

```jsonc
{
  "schemaVersion": 1,
  "gameVersion": "4.10.2",
  "units": "Gm",
  "generator": { "scheme": "routing", "scope": "all-live-terminals", "weights": "1/d", "iterations": 500,
                 "jumpCost": 70, "coOrbitSpread": 0.15 },
  "systems": [
    {
      "id": 68, "name": "Stanton",
      "nodeIds": ["planet:4", "moon:50", "station:1"],        // order used by `measured`
      "layout": { "cx": 0.0, "cy": 0.0, "rotationDeg": 0.0 }, // panel in the combined map (§5.4)
      "quality": { "stress1": 0.031, "meanRelError": 0.04, "maxRelError": 0.31, "planarShare": 0.97, "pairs": 403 },
      "measured": [ [0, 1, 0.15], [0, 2, 21.4] ]               // [i, j, Gm], i < j, the routing set
    }
  ],
  "nodes": [
    {
      "id": "planet:116", "system": 68, "kind": "planet", "name": "Hurston", "orbitId": 116,
      "group": "planet:116",              // parent planet node, null for standalone nodes (gateways, Nyx stations, Delamar)
      "terminalIds": [18, 30, 31],
      "hasCommodityTerminal": true,
      "x": 12.345, "y": -3.21,           // system-local, Gm
      "offset": false                    // true: placed by the 0.15 Gm co-orbit rule, not by distance data
    }
  ],
  "jumps": [ { "a": "station:24", "b": "station:50", "cost": 70, "jumpPointIds": [1, 2] } ],
  "terminalNode": { "18": "planet:116" } // terminal id → node id, covers every terminal in scope
}
```

`kind` is `planet | moon | station | orbit`. Coordinates are system-local and metric. The combined-map position of a node is `layout.c + R(layout.rotationDeg) · (x, y)`.

### 5.3 Co-orbit spread

If the API returns no usable distance between nodes of one orbit (identical distances to everything else, or 0 / an error for planet ↔ moon), the compiler places the group's planet at the shared point and the other members of that orbit (the moons first, in id order, then the stations on the same orbit) on a circle of **radius 0.15 Gm** around it, with `offset: true`. The measured pair between them is stored as 0.15, so lookups and the drawing agree. If the API does separate them, the MDS positions are used and nothing is spread. The largest cluster has 5 nodes at 0.15 Gm, so they stay ≥ 0.17 Gm apart.

### 5.4 Distances, routes and drawing

- **Distance between two nodes of a system** (travel graph, §2.5): Dijkstra over the directed edges built from `measured` (all edges needed by the rules are in it). Two terminals on one node: 0. No file needs to carry the all-pairs table; 71 nodes make it instant.
- **Distance across systems:** the same Dijkstra over all systems, with the `jumps` edges (cost 70) between gateway nodes. In the triangle the shorter of the direct and the via-third-system path wins.
- **Straight-line estimate** between any two nodes of a system, when only the map is available: `‖p − q‖` of the system-local coordinates.
- **Drawing:** one panel per system, placed on fixed positions in system-id order on a circle (radius = sum of the two largest panel radii + a gap), each rotated by the closed-form angle that best points its gateways at the panels they lead to. Jump edges are straight lines between gateway nodes. Systems are not co-located in reality, so this layout is schematic by design; it is stored in `layout`, separate from the metric coordinates.

### 5.5 Future uses mapped to the data

| Use | Data |
|---|---|
| Distance between two terminals | `terminalNode` → two nodes → Dijkstra over `measured` + `jumps` (§5.4). Same node → 0. |
| Terminals along a route | route legs as segments in the system plane: nodes whose point-to-segment distance ≤ ε, expanded to `terminalIds`. Needs only `x`, `y`. |
| 2D drawing | `layout` + `x`, `y` + `jumps` + per-system `quality` as a confidence hint. |

## 6. Open questions and data gaps

1. **H1 — are `terminals_distances` orbit-derived?** Decides the 585- vs 306-call set and whether the 0.15 Gm spread is needed at all. Check: Hurston → Aberdeen (planet to its own moon), Aberdeen → Area18 against Hurston → Area18.
2. **Symmetry:** is `d(A,B) = d(B,A)`? If not, the counts double (and values are averaged or kept per direction).
3. **`orbits_distances` coverage:** complete or sparse; rows for the same system pair; shape. Unknown.
4. **Jump cost** is the constant 70 Gm (decided). If travel-time realism is ever wanted, it is the only config value that changes (`generator.jumpCost`).
5. **Terra Gateway** has no jump partner in 4.10.2 (§2.3); the node stays.
6. **Data quirks** seen: terminal rows with a wrong `id_orbit` (Chawla's Beach), two terminals without any location id, Pyro V is a planet node that only has an item terminal while its moons have commodity terminals, 10 `PYAM-*` stations and `INS Jericho` exist in the metadata without terminals (not nodes).
7. **Scale:** member-to-planet distances are small next to planet-to-planet ones (moons 0.15 Gm vs tens of Gm), so the combined map needs zoom.
8. **Please confirm the travel rules (§2.5):** (a) member ↔ member inside one group is direct (the rule only says planet → members); (b) "the system can be left from any location" is read as "from any member you can go straight to an entry node of another group or a gateway" (planetary system, not star system; the graph handles both the same way); (c) the co-orbit spread of 0.15 Gm also covers stations that sit on their planet's orbit, not only moons.

## 7. Phase-2 probe (needs the product owner's go-ahead)

Eight calls, all part of the routing set except the first three. They run first in the compiler and decide H1, symmetry and `orbits_distances`:

| # | Call | Answers |
|---|---|---|
| 1–3 | `orbits_distances?id_star_system_origin=S&id_star_system_destination=S` for S = 68, 64, 55 | Q3 (rows, completeness, shape) |
| 4–5 | `terminals_distances` Lorville (18) → Area18 (12) and Area18 (12) → Lorville (18) | Q2, response shape, unit |
| 6 | Lorville (18) → Aberdeen (28) | Q1: planet ↔ own moon |
| 7 | Aberdeen (28) → Area18 (12), compared with #4 | Q1: moon vs planet |
| 8 | Everus Harbor (25) → Area18 (12), compared with #4 | Q1: station on the planet's orbit |

Then the routing compile (§3.4) starts. Phase-1 tooling for it exists: `tools/terminal-map/compile.py --dry-run` prints the node list with groups, the jump edges and the request counts of every scheme, and `--plan-out` with `--scheme` writes the request list.

## 8. Tooling in this repo

```bash
docker compose run --rm terminal-map --dry-run                       # nodes, groups, call counts (fetches 8 metadata endpoints once)
docker compose run --rm terminal-map --dry-run --types commodity     # commodity-only scope
docker compose run --rm terminal-map --dry-run --rate 100            # duration at another rate
docker compose run --rm terminal-map --dry-run --scheme routing --plan-out /work/tools/terminal-map/cache/plan.jsonl
```

`uex_get` in `compile.py` refuses `terminals_distances` / `orbits_distances`, so a phase-1 run can never hit a distance endpoint. Metadata is cached in `tools/terminal-map/cache/<gameVersion>/meta/` (git-ignored). Run the last command with `MSYS_NO_PATHCONV=1` under Git Bash.
