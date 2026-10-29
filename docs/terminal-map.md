# Terminal map — design and distance-call analysis (phase 1)

Status: phase 1 (research and design) · Written: 2026-10-29 · Game version analysed: Star Citizen LIVE 4.10.2

Goal: a deterministic, pre-compiled 2D map of terminal locations, computed with MDS from UEX distance data and imported by the app like the caches in `src/api/`. Later uses (the data is designed for them, nothing is built yet): distance between two terminals, terminals along a route, drawing the graph.

**No distance endpoint has been called.** Phase 1 made ~22 requests to metadata endpoints (`game_versions`, `star_systems`, `planets`, `moons`, `space_stations`, `orbits`, `jump_points`, `terminals`, plus `cities` and `outposts` for inspection) and read the endpoint documentation.

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

So one request returns **one pair, terminal to terminal**. There is no "all destinations from one origin" form. The response echoes the *orbit* of each terminal and not a body, which suggests the distance is derived from orbit-to-orbit data (hypothesis H1, see §6).

### 1.2 `GET /orbits_distances` — orbit ↔ orbit, possibly many pairs per call

`orbits_distances?id_star_system_origin={int}&id_star_system_destination={int}[&id_orbit_origin={int}&id_orbit_destination={int}]` (the old `id_star_system` is deprecated) · cache TTL 1 day · "the last orbital distances reported by Datarunners".

Response: a list of records `{id, id_star_system_origin, id_star_system_destination, id_orbit_origin, id_orbit_destination, distance (Gm), game_version, date_added, date_modified, *_name…}`. The orbit ids are optional filters, so **one call without them can return every reported orbit pair of a system pair**. Whether the list is complete or sparse (only pairs Datarunners reported) is unknown and cannot be seen without calling it. Orbits are planets, Lagrange points, stations, gateways and asteroids; **moons have no orbit of their own** (a moon's `id_orbit` is its planet's). `orbits_distances` therefore cannot separate a planet from its moons, and the game version tag in each row is useful for caching.

If it is complete, the whole compilation is ~3 calls (§3.2, tier A). That is the first thing to verify in phase 2.

Not used for distances: `jump_points` (metadata, no length), `commodities_routes`.

## 2. Node list (real metadata, game 4.10.2)

### 2.1 Rules

- Scope: terminals with `is_available_live && is_visible`, **all terminal types** (754 terminals; 114 of them commodity terminals — the set the app uses). `--types commodity` restricts it.
- Node key, first match wins: `id_space_station` → `station:<id>`; `id_moon` → `moon:<id>`; `id_planet` → `planet:<id>`; `id_orbit` → `orbit:<id>`. So a city or outpost belongs to its moon or planet, a station is always its own node (also Lagrange and gateway stations), and Levski (a city on the asteroid Delamar, no planet) is `orbit:325`.
- Node name comes from the `moons` / `planets` / `space_stations` / `orbits` record, not from a terminal's `displayname` (not unique).
- A node's orbit is read from its own record (`planet` id = orbit id, `moon.id_orbit` = planet's orbit, `station.id_orbit`), **not** from the terminal rows: terminal rows can be wrong (Chawla's Beach is on Pyro IV, its terminals say orbit Pyro V).
- One request representative per node: its commodity terminal if it has one, otherwise the lowest terminal id. The compiler stores every member terminal id.

### 2.2 Nodes per system

| System | Nodes (all types) | planet | moon | station | orbit | Distinct orbits | Nodes with a commodity terminal |
|---|---:|---:|---:|---:|---:|---:|---:|
| Stanton | **45** | 4 | 12 | 29 | 0 | 28 | 42 |
| Pyro | **22** | 6 | 3 | 13 | 0 | 17 | 20 |
| Nyx | **7** | 0 | 0 | 6 | 1 | 7 | 7 |
| **Total** | **74** | 10 | 15 | 48 | 1 | 52 | 69 |

(`docker compose run --rm terminal-map --dry-run` prints the full list. Only Stanton, Pyro and Nyx are live; the 93 other star systems in the table are not available.)

- **Stanton** — planets ArcCorp, Crusader, Hurston, MicroTech; moons Aberdeen, Arial, Ita, Magda (Hurston), Calliope, Clio, Euterpe (MicroTech), Cellin, Daymar, Yela (Crusader), Lyria, Wala (ArcCorp); stations ARC-L1…L5, CRU-L1/L4/L5, HUR-L1…L5, MIC-L1…L5, Baijini Point, Everus Harbor, Port Tressler, Seraphim Station, Green Imperial Housing Exchange (Grim HEX), Pyro Gateway, Nyx Gateway, Terra Gateway, Wikelo Emporium Kinga/Dasi/Selo.
- **Pyro** — planets Pyro I, Monox, Bloom, Pyro IV, Pyro V, Terminus; moons Adir, Ignis, Vatra; stations Orbituary, Ruin Station, Endgame, Megumi Refueling, Patch City, Gaslight, Rod's Fuel 'N Supplies, Rat's Nest, Dudley & Daughters, Checkmate Station, Starlight Service Station, Stanton Gateway, Nyx Gateway.
- **Nyx** — Delamar (Levski), People's Service Station Alpha/Delta/Lambda/Theta, Stanton Gateway, Pyro Gateway.

### 2.3 Jump points and gateways

`jump_points` has 6 rows (directional, 3 pairs). Each end is an orbit that is also a gateway *station* (`is_jump_point = 1`), which is exactly the "jump point connects only to its gateway station" rule:

| Edge | Gateway station A | Gateway station B | `jump_points` ids |
|---|---|---|---|
| Stanton ↔ Pyro | `station:24` Pyro Gateway (Stanton) | `station:50` Stanton Gateway (Pyro) | 1, 2 |
| Pyro ↔ Nyx | `station:55` Nyx Gateway (Pyro) | `station:57` Pyro Gateway (Nyx) | 3, 6 |
| Nyx ↔ Stanton | `station:56` Stanton Gateway (Nyx) | `station:25` Nyx Gateway (Stanton) | 4, 5 |

Two deviations from the brief to keep in mind:

1. **The systems form a triangle, not a tree.** Every pair of systems is linked, so a cross-system route has two candidate paths (direct, or through the third system). Cross-system distance must be a shortest path over the gateway graph (§5.4), not a unique chain.
2. **Terra Gateway (Stanton)** (`station:26`, 19 terminals, one commodity terminal) is a gateway station without a `jump_points` row (Terra is not a live system). It is kept as an ordinary Stanton node with no jump edge.

### 2.4 Nodes the distance endpoints cannot address

- **Orbit 0 — not addressable by `orbits_distances`:** Wikelo Emporium Kinga/Dasi/Selo stations (`station:51–53`, one fuel terminal each, `id_orbit = 0`). They are addressable by `terminals_distances` only if that endpoint does not depend on orbits (H1 decides).
- **No location ids at all — dropped:** terminal 725 "Landing Services - Covalex Distribution Centre S4DC05" (fuel) and terminal 792 "NovaworX Industries - ORISON" (item; it clearly belongs to Orison, i.e. Crusader's planet node, but the record has no ids). Neither is a commodity terminal.
- **Moons and planets share an orbit** (e.g. Hurston orbit 116 holds Hurston, Aberdeen, Arial, Ita, Magda and Everus Harbor). If distances are orbit-derived, those nodes are indistinguishable for the API (Stanton: 45 nodes in 28 orbits, Pyro: 22 in 17), and the map has to lay co-orbit nodes out by a display rule (§5.3).

## 3. Distance calls

All numbers: unordered pairs, scope = all 74 nodes, `compile.py --dry-run` output. If the endpoint is asymmetric (to be checked, §6) double every figure. Planned rate: **90 requests/minute** (75 % of the 120/min limit, ≈ 0.67 s between requests, 429 / `requests_limit_reached` → exponential back-off); the 172,800/day quota is irrelevant.

### 3.1 `terminals_distances` (one pair per call)

| Scheme | Stanton | Pyro | Nyx | Total | At 90 req/min |
|---|---|---|---|---:|---:|
| **Full node matrix** `n(n−1)/2` | 45·44/2 = 990 | 22·21/2 = 231 | 7·6/2 = 21 | **1,242** | 13.8 min |
| **Orbit-deduplicated** (one representative per orbit, only valid under H1) `o(o−1)/2` | 28·27/2 = 378 | 17·16/2 = 136 | 21 | **535** | 5.9 min |
| **Landmarks** `k(k−1)/2 + k(n−k)`, landmarks = gateways + planet nodes | k=6: 15 + 6·39 = 249 | k=8: 28 + 8·14 = 140 | full: 21 | **410** | 4.6 min |
| Jump edges | not measured: constant length (§5.4) | | | 0 (+3 optional, §7) | |

Commodity-only scope (69 nodes): full 861 + 190 + 21 = 1,072 (11.9 min), orbit 300 + 136 + 21 = 457, landmarks 231 + 112 + 21 = 364.

Cross-system pairs are **never requested**: they follow from the within-system matrices plus the jump edges.

### 3.2 `orbits_distances` (if it returns whole pair lists)

| Tier | Calls |
|---|---|
| A — one call per system (`origin = destination = system`) | 3 |
| B — plus the three system pairs, if cross-system rows are wanted | 3 + 3 |

Row counts, completeness and whether cross-system rows exist are unknown until one call is made (§7). Even with full coverage it does not resolve moons from planets, so it replaces the `orbit` scheme (535 calls), not the node matrix.

### 3.3 What MDS really needs

A 2D embedding of n points is determined by far fewer than n(n−1)/2 distances (≥ 3 well-spread anchors fix it in the exact case; ~6–8 give robustness to noise). The landmark scheme above is that minimum: 410 calls instead of 1,242. It costs accuracy where it matters for the later uses: two nodes that are close to each other (a planet and its moons, the stations of one Lagrange system) are only constrained through far-away landmarks, so their mutual distance and corridor tests are blurry, and "distance between two terminals" would be an estimate even where UEX has the exact value.

### 3.4 Recommendation for the budget

- **Run the full node matrix (1,242 calls, ≈ 14 min, once per game version)**, but only after the probe in §7. It gives the exact pairwise table (stored next to the coordinates, §5.5) and the best stress for the near neighbours. The saving of landmarks is ≈ 8 minutes once per patch, not worth the accuracy.
- If the probe confirms H1 (orbit-derived), use the **orbit scheme: 535 calls (≈ 6 min) with no information lost**, and expand to nodes at compile time.
- If `orbits_distances` is complete, the compile needs ≈ 3 calls plus a handful of terminal calls for moon/planet offsets. Check it first, it may make everything else unnecessary.
- `--scheme landmark` stays available as a fallback if the API throttles us.

### 3.5 Caching and later game versions

- Raw responses are stored **one record per terminal pair, append-only** in `tools/terminal-map/raw/<gameVersion>.jsonl` and **committed** (≈ 1,242 short lines ≈ 250 KB). They are the compiler's only input besides the metadata, so a recompile (algorithm change, new seed, new output shape) makes **0 requests**. Metadata responses are cached beside them (`tools/terminal-map/cache/`, git-ignored: 8 cheap requests).
- A pair key is `(origin terminal, destination terminal)` and does not contain the game version. For a new version the compiler diffs the node list: unchanged nodes keep their pairs (copied forward and tagged with the version they were measured in); each **new** node costs `n − 1` calls (a new Stanton station: 45 instead of 1,242); removed nodes drop out.
- Moved bodies cannot be detected from metadata, so each new version re-measures a deterministic sample (e.g. every 20th pair + all pairs of gateway nodes, ≈ 80 calls, ~1 min) and recomputes everything if any differs by more than 1 %. UEX also tags `orbits_distances` rows with `game_version`, which may make this a free check.
- `terminals_distances` has a 12 h server cache, so retries within a day are free for UEX too.

## 4. Language, tooling and algorithm

### 4.1 Python in a Docker image

**Python** (numpy), not Node:

- Classical MDS is an eigendecomposition and SMACOF is ~25 lines of matrix algebra; `numpy.linalg.eigh` is exactly the tool. The JS ecosystem has no maintained MDS library (only generic matrix packages), so a Node compiler would hand-roll both on top of `ml-matrix`.
- scikit-learn's `MDS` is not needed: it has no weights or missing-value support, which the landmark/sparse case needs, and it drags in scipy. A weighted SMACOF is written directly in numpy.
- The compiler is a build-time tool, not app code. A separate image keeps the app's `package.json` / lockfile clean (SPEC §2: only Docker on the host, satisfied) and the app only imports the JSON output.
- Image: pinned `python:3.13.x-alpine` (`tools/terminal-map/Dockerfile`), pinned numpy in `requirements.txt` when the MDS step arrives. Phase 1 needs the standard library only.

### 4.2 Algorithm (per star system)

1. **Matrix**: symmetric `D` of node distances in Gm. Missing entries (landmark scheme only) are marked `NaN`; they get weight 0 in SMACOF and are filled from graph shortest paths for the initial guess.
2. **Initialization**: classical (Torgerson) MDS: double-centre `−½ J D² J`, `eigh`, take the two largest eigenpairs. This is not random, so there are no restarts.
3. **Refinement**: weighted SMACOF (stress majorization) from that start, `w_ij = 1 / d_ij` (a Sammon-like compromise, so the many short moon/station distances are not drowned by the planet-to-planet ones), fixed maximum of 500 iterations and a relative tolerance of 1e-9. The weights are tuned once on the measured stress in phase 2 and then fixed in the data file's `generator` block.
4. **Why SMACOF on top of classical MDS**: the data is 3D projected to 2D and not exactly Euclidean (jump gateways, travel-based estimates). Classical MDS minimises the wrong thing in that case (it truncates eigenvalues); SMACOF minimises the actual stress. Both run per system, because Stanton, Pyro and Nyx are separate coordinate spaces.
5. **Quality metrics** (stored per system, §5.5): `stress1` (Kruskal stress-1), mean and max relative pair error, and `planarShare` = (λ₁+λ₂)/Σ positive λ from the classical step, which says how much of the system is really 2D (if it is low, a 2D map is a poor fit).

### 4.3 Determinism

Same input → byte-identical output:

- No randomness anywhere (deterministic init, fixed iteration count). If one is ever introduced it uses `numpy.random.default_rng(0)`.
- **Canonical frame** per system: translate the centroid to 0, rotate to the principal axes (eigenvectors of the coordinate covariance, ordered by eigenvalue), then fix the signs: each axis is flipped so that Σ x·|x| ≥ 0 (ties → by smallest node id). That removes the rotation and reflection freedom of MDS. Units stay Gm (never normalised), so `‖a − b‖` approximates the distance.
- Stable order: nodes sorted by `(system id, kind rank, numeric id)`, JSON written with sorted keys, compact separators, `\n` line endings, coordinates rounded to 3 decimals (1 Mm) with `-0.0` normalised to `0.0`.
- `OPENBLAS_NUM_THREADS=1`, `PYTHONHASHSEED=0`, base image pinned by digest.
- Float differences between CPU architectures are absorbed by the rounding except in the (astronomically unlikely) case of a value on a rounding boundary, so the compiler has **`--check`**: recompile from the committed raw cache and fail if the result differs from the committed file; CI/`docker compose run` can run it. If it ever flaps, the fallback is a pure-stdlib implementation (Jacobi eigensolver + SMACOF; n ≤ 45, runs in < 1 s and only uses `+ − × ÷ √`, which are bit-exact everywhere).

## 5. Output data

### 5.1 File and import

`src/data/terminalMap/<gameVersion>.json` (e.g. `4.10.2.json`) plus an `index.ts` that maps version → lazy `import()`. The app looks up the LIVE version (the same `GameVersions` the cache layer already holds) and falls back to the newest older file, marking the map "from 4.10.2". The data is static per version, so it needs no TTL, only the `schemaVersion` check the caches already have. Approximate size ≈ 30 KB (≈ 55 KB with the matrix).

### 5.2 Shape

```jsonc
{
  "schemaVersion": 1,
  "gameVersion": "4.10.2",
  "units": "Gm",
  "generator": { "scheme": "full", "scope": "all-live-terminals", "weights": "1/d", "iterations": 500 },
  "systems": [
    {
      "id": 68, "name": "Stanton",
      "nodeIds": ["moon:1", "planet:116", "station:1"],   // = matrix order
      "layout": { "cx": 0.0, "cy": 0.0, "rotationDeg": 0.0 },   // panel in the combined map (§5.4)
      "quality": { "stress1": 0.031, "meanRelError": 0.04, "maxRelError": 0.31, "planarShare": 0.97, "pairs": 990, "pairsMeasured": 990 },
      "matrix": [ /* upper triangle, row-major, Gm, same order as nodeIds */ ]   // optional
    }
  ],
  "nodes": [
    {
      "id": "planet:116", "system": 68, "kind": "planet", "name": "Hurston", "orbitId": 116,
      "terminalIds": [18, 30, 31],
      "hasCommodityTerminal": true,
      "x": 12.345, "y": -3.21,            // system-local, Gm
      "offset": false                    // true: placed by the co-orbit display rule, not by distance data
    }
  ],
  "jumps": [ { "a": "station:24", "b": "station:50", "cost": 0, "jumpPointIds": [1, 2] } ],
  "terminalNode": { "18": "planet:116" }   // terminal id → node id, covers every terminal in scope
}
```

`kind` is `planet | moon | station | orbit`. Coordinates are system-local and metric. The combined-map position of a node is `layout.c + R(layout.rotationDeg) · (x, y)`, which is cheap to compute in the UI and keeps `x`,`y` usable for distances.

### 5.3 Co-orbit nodes

If the probe shows that nodes in one orbit have identical distances to everything else (H1), the matrix has duplicate rows. The compiler then places the cluster's anchor (the planet node, else the lowest id) at the shared point and the other members on a circle around it (radius 0.5 % of the system diameter, angles in id order), with `offset: true`. `matrix` entries between such nodes are written as the 0 UEX reports, so exact lookups stay truthful and only the drawing is spread.

### 5.4 Combining systems

- Each system is its own MDS (coordinates are not comparable across systems).
- **Distance within a system**: the matrix entry if present, else `‖p − q‖`.
- **Distance across systems**: Dijkstra over the node graph: within a system nodes are fully connected with matrix distances, jump edges join the gateway pairs with `cost` = constant (`0` by default; the API has no length for a jump, so it is a config value and not data). With the triangle of systems the shortest of the direct and the via-third-system path wins. Result needs no extra API calls.
- **Drawing**: system panels are placed on fixed positions in system-id order on a circle (radius = sum of the two largest panel radii + a gap), each rotated by the closed-form angle that best points its gateways at the panels they lead to. The drawn jump edges are straight lines between gateway nodes. Systems are not co-located in reality, so this layout is schematic by design, and it is stored in `layout`, separate from the metric coordinates.

### 5.5 Future uses mapped to the data

| Use | Data |
|---|---|
| Distance between two terminals | `terminalNode` → two nodes → `matrix` / Euclid / Dijkstra (§5.4). Same node → 0. |
| Terminals along a route | route legs as segments in the system plane: nodes whose point-to-segment distance ≤ ε, filtered by `terminalIds`. Needs only `x`,`y`. |
| 2D drawing | `layout` + `x`,`y` + `jumps` + per-system `quality` for a confidence hint. |

## 6. Open questions and data gaps (all need a few real calls)

1. **H1 — are `terminals_distances` orbit-derived?** Check whether two terminals in one orbit (Hurston and Aberdeen, orbit 116) return identical distances to a third node, and what Hurston ↔ Aberdeen itself returns (0? error? a real value?). Decides orbit scheme (535) vs full (1,242) and whether moons are separable at all.
2. **Symmetry**: is `d(A,B) = d(B,A)`? If not, the counts double (and the matrix is averaged or kept directional).
3. **Terminal independence**: do two terminals of the same node (e.g. Hurston's 29 terminals) return the same distance? If not, the representative choice matters.
4. **What the distance means**: straight-line gigameters, or quantum-travel distance? The docs say "estimates". It affects how Euclidean the data is (`planarShare`, stress) but not the pipeline.
5. **`orbits_distances` coverage**: complete or sparse? Cross-system rows?
6. **Cross-system terminal pairs**: what does `terminals_distances` return for Stanton ↔ Pyro? (Not needed by the design; if it returns something sensible it could validate the jump cost.)
7. **Jump length**: no data source for the length or time of a jump; `cost` is a constant (default 0).
8. **Terra Gateway** is a dead-end node (no jump row); keep it, with its distances.
9. **Data quirks**: terminal rows with a wrong `id_orbit` (Chawla's Beach), orbit 0 for the three Wikelo stations, two terminals without any location id, Pyro V is a planet node with only an item terminal while its moons carry commodity terminals.
10. **Scale**: moon-to-planet distances are probably ~1 % of planet-to-planet ones, so the combined map needs zoom; the stored metric coordinates are scale-faithful on purpose.
11. **Scope default**: this design uses all terminal types (74 nodes; +170 calls over commodity-only). If the product owner only cares about commodity locations, `--types commodity` gives 69 nodes and 1,072 calls.

## 7. Phase-2 probe (needs the product owner's go-ahead)

Eleven calls, all of them in one run of the compiler in a `--probe` mode that writes the raw responses to the cache:

| # | Call | Answers |
|---|---|---|
| 1–3 | `orbits_distances?id_star_system_origin=S&id_star_system_destination=S` for S = 68, 64, 55 | Q5 (rows, completeness, shape) |
| 4–5 | `terminals_distances` Lorville (18) → Area18 (12), and Area18 (12) → Lorville (18) | symmetry, response shape, unit |
| 6 | Lorville (18) → Aberdeen (28) | Q1: planet ↔ own moon |
| 7 | Everus Harbor (25) → Area18 (12) vs #4 | Q1: same orbit, different node |
| 8 | Lorville terminal 31 → Area18 (12) vs #4 | Q3 |
| 9 | Aberdeen (28) → Area18 (12) vs #4 | Q1: moon vs planet |
| 10 | Pyro Gateway (Stanton) (252) → Stanton Gateway (Pyro) (520) | Q6 |
| 11 | Wikelo Emporium Kinga (its fuel terminal) → Area18 | whether orbit 0 nodes are addressable |

Then the full compile (§3.4) can start. Phase-1 tooling for it already exists: `tools/terminal-map/compile.py --dry-run` prints the node list, the jump edges and the request counts of all three schemes, and `--plan-out` writes the full-matrix request list.

## 8. Tooling in this repo

```bash
docker compose run --rm terminal-map --dry-run                       # node list + call counts (fetches 8 metadata endpoints once)
docker compose run --rm terminal-map --dry-run --types commodity     # commodity-only scope
docker compose run --rm terminal-map --dry-run --rate 100            # duration at another rate
```

`uex_get` in `compile.py` refuses `terminals_distances` / `orbits_distances`, so a phase-1 run can never hit a distance endpoint. Metadata is cached in `tools/terminal-map/cache/<gameVersion>/meta/` (git-ignored).
