# Terminal map — design and distance-call analysis (phase 1)

Status: phase 2 (compiler built, 4.10.2 compiled), revision 4 · Written: 2026-10-29 · Game version analysed: Star Citizen LIVE 4.10.2

Goal: a deterministic, pre-compiled 2D map of terminal locations, computed with MDS from UEX distance data and imported by the app like the caches in `src/api/`. Later uses (the data is designed for them, nothing is built yet): distance between two terminals, terminals along a route, drawing the graph.

**Distance calls made so far: 8** (the probe of §7, approved by the product owner): 3 × `orbits_distances`, 5 × `terminals_distances`. Result in short: **one `orbits_distances` call per star system already returns every orbit pair the map needs, so the full compilation needs no further distance calls** (§3). Phase 1 also made ~25 requests to metadata endpoints (`game_versions`, `star_systems`, `planets`, `moons`, `space_stations`, `orbits`, `jump_points`, `terminals`, plus `cities` and `outposts` for inspection).

### Product owner decisions (2026-10-29)

1. The map is a **good-enough representation**: travel-time differences are ignored (loading cargo dominates). All distances are **straight lines**, and one terminal per node stands for the whole node (all terminals at Cellin share the distances of the Cellin node).
2. A gateway station is an ordinary node of the graph, so `A → gateway → B` routes exist. Jump points connect gateway stations. (Revision 1 called Terra Gateway a "dead end"; that only meant it has no partner gateway in this game version.)
3. **Wikelo Emporium stations are ignored.**
4. A jump costs a **constant ~70 Gm**.
5. If the API cannot tell moon terminals from planet terminals, **spread the moons 0.15 Gm** around the planet. (It cannot, see §1.1.)
6. **Travel rule:** from outside a planetary system you can only travel to its planet, and from there to its moons and stations. A planetary system can be left from any location in it (§2.5).

## 1. Distance endpoints (observed 2026-10-29, game 4.10.2)

Docs: <https://uexcorp.space/api/documentation>. Two endpoints, both public (no key), GET, JSON envelope as in SPEC §4. Raw probe responses: `tools/terminal-map/raw/4.10.2/probe.jsonl` (≈ 0.9 MB, committed).

### 1.1 `GET /terminals_distances` — terminal ↔ terminal, one pair per call

`terminals_distances?id_terminal_origin={int}&id_terminal_destination={int}` · server cache 12 h · both parameters required. One request returns **one pair**; there is no "all destinations from one origin" form. `data` is a single **object** (not an array):

```json
{ "status": "ok", "http_code": 200, "message": "",
  "data": { "distance": "23",
            "terminal_name_origin": "CBD - Central Business District - Lorville", "terminal_nickname_origin": "CBD Lorville",
            "terminal_code_origin": "CBD", "orbit_name_origin": "Hurston",
            "terminal_name_destination": "TDD - Trade and Development Division - Area 18", "terminal_nickname_destination": "TDD Area 18",
            "terminal_code_destination": "TDA18", "orbit_name_destination": "ArcCorp" } }
```

What the five probe calls showed:

| Call | Result |
|---|---|
| Lorville (18) → Area18 (12) | `"23"` |
| Area18 (12) → Lorville (18) | `"23"`: **symmetric** |
| Aberdeen / HDMS-Anderson (28) → Area18 (12) | `"23"`, `orbit_name_origin: "Hurston"` |
| Everus Harbor (25) → Area18 (12) | `"23"`, `orbit_name_origin: "Hurston"` |
| Lorville (18) → Aberdeen (28), same orbit | `"status": "ok"` but **`data: false`** (no value) |

So the endpoint is **orbit-derived (H1 confirmed)**: a terminal is its orbit. A planet, its moons and every station sitting on the planet's orbit are indistinguishable, and a pair inside one orbit has no distance at all (`data: false`, still HTTP 200 / `status: ok`; the client must treat a non-object `data` as "unknown"). `distance` is a numeric **string** and an **integer number of Gm**.

### 1.2 `GET /orbits_distances` — orbit ↔ orbit, all pairs of a system in one call

`orbits_distances?id_star_system_origin={S}&id_star_system_destination={S}` (orbit ids are optional filters) · "last orbital distances reported by Datarunners". `data` is a **list with one row per directed orbit pair**:

```json
{ "id": 1, "id_star_system_origin": 68, "id_star_system_destination": 68,
  "id_orbit_origin": 59, "id_orbit_destination": 4,
  "orbit_origin_name": "Crusader", "orbit_destination_name": "ArcCorp",
  "distance": "42", "game_version": "4.3.2", "date_added": 1729629321, "date_modified": 1763193403, "...": "name fields" }
```

| System | Rows | Orbits | Undirected pairs | Complete? |
|---|---:|---:|---:|---|
| Stanton (68) | 810 | 29 | 405 of 406 | all but one pair |
| Pyro (64) | 1,438 | 43 | 716 of 903 | sparse overall (6 duplicate rows) |
| Nyx (55) | 56 | 8 | 28 of 28 | complete |

**For the 71 nodes of this map the coverage is complete: all 300 + 136 + 21 = 457 orbit pairs between the node orbits are present** (checked against the node list). The values agree with `terminals_distances` (Hurston ↔ ArcCorp = 23 in both). Details:

- Distances are integer Gm (`"42"`), a resolution of 1 Gm: good enough for the product owner's purpose, and the 0.15 Gm moon spread stays below it by design.
- Rows carry the **game version they were reported in** (4.0 … 4.10.2; most are 4.3.2–4.7.1). "Static per game version" is therefore only roughly true: the data is whatever was last reported. The compiler stores the row versions and can print the oldest one used.
- Symmetric for practical purposes: 1,145 of 1,149 pairs that exist in both directions have equal values in both. The 4 exceptions all involve orbit 359 (not a node orbit; e.g. 39 vs 80), so they do not affect this map. For asymmetric values the compiler takes the mean.
- Not usable for moons: moons have no orbit of their own (a moon's `id_orbit` is its planet's).

Not used for distances: `jump_points` (metadata, no length), `commodities_routes`.

## 2. Nodes, groups and the travel graph (real metadata, game 4.10.2)

### 2.1 Node rules

- Scope: terminals with `is_available_live && is_visible`, **all terminal types** (754 terminals; 114 are commodity terminals, the set the app uses). `--types commodity` restricts it (then a planet that only has non-commodity terminals loses its node; the figures below are for all types).
- Node key, first match wins: `id_space_station` → `station:<id>`; `id_moon` → `moon:<id>`; `id_planet` → `planet:<id>`; `id_orbit` → `orbit:<id>`. So a city or outpost belongs to its moon or planet, a space station is always its own node (also Lagrange and gateway stations), and Levski (a city on the asteroid Delamar, no planet) is `orbit:325`.
- Node name comes from the `moons` / `planets` / `space_stations` / `orbits` record, not from a terminal's `displayname` (not unique).
- A node's orbit is read from its own record (planet id = orbit id, `moon.id_orbit` = the planet's orbit, `station.id_orbit`), **not** from the terminal rows: terminal rows can be wrong (Chawla's Beach is on Pyro IV, its terminals say orbit Pyro V).
- Every member terminal id is stored per node. (`compile.py` also picks a request representative per node, its first commodity terminal; only the old terminal-pair schemes need it.)
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

Moons have no orbit of their own, and several stations sit on their planet's orbit (Baijini Point, Everus Harbor, Port Tressler, Seraphim, Green Imperial, Orbituary, Ruin Station). UEX distances are orbit-derived (§1.1), so such nodes are one point for the API. Stanton has 42 nodes on 25 orbits, Pyro 22 on 17. Display rule in §5.3: **0.15 Gm spread around the planet**.

### 2.5 Travel rules (the routing graph)

A **group** is a planet node with its moons and stations (stations are assigned through `space_stations.id_planet`, moons through `moons.id_planet`; Lagrange stations, Everus Harbor, Grim HEX at Yela belong to their planet). Nodes without a parent planet stand alone: the gateways, the Nyx stations and Delamar. **Entry nodes** are planets and standalone nodes. Per star system the directed graph is (weights are straight-line distances):

| From → to | Allowed | Weight |
|---|---|---|
| entry → entry (any group) | yes | `d` |
| planet ↔ its own moons/stations | yes | `d` |
| member ↔ member of the same group | yes (confirmed; §6 Q1) | `d` |
| any member → entry outside its group | yes ("the system can be left from any location") | `d` |
| entry or member of another group → member | **no** — arrive at the planet first | via the planet |
| gateway ↔ its partner gateway in the other system | yes | **70 Gm** (constant) |

Consequences:

- The graph is directed: Area18 → Aberdeen is `d(Area18, Hurston) + d(Hurston, Aberdeen)`, while Aberdeen → Area18 is the direct `d(Aberdeen, Area18)`. Cross-system routes work through the gateway entry nodes with the same rules, e.g. Cellin → Pyro Gateway (Stanton) → jump 70 → Stanton Gateway (Pyro) → Monox → Checkmate.
- The rules only use entry–entry, member-to-entry and within-group pairs; member-to-member across groups is never needed. That mattered while distances were costed per terminal pair (585 instead of 1,113 calls), but `orbits_distances` delivers all pairs anyway (§3), so the measured data is a superset of what routing uses.
- The 2D embedding is fitted to the same orbit distances; the rules only change how routes are composed from them.


## 3. Distance calls

### 3.1 What the compilation needs

Because every distance is orbit-derived (§1.1), the information content of the whole map is **one distance per pair of distinct node orbits per star system**: Stanton 25 orbits → 300 pairs, Pyro 17 → 136, Nyx 7 → 21; 457 in total. Pairs inside one orbit (a planet and its moons, a station on the planet's orbit) have no distance and get the 0.15 Gm rule (§5.3). The routing set of §2.5 is a subset of these pairs, so nothing more is needed for routing either.

| Source | Calls | Time |
|---|---:|---|
| **`orbits_distances`, one call per star system** (Stanton, Pyro, Nyx) | **3** | seconds |
| `terminals_distances`, one call per orbit pair | 457 | 5.1 min at 90 req/min |
| `terminals_distances`, routing set, one call per node pair (before H1 was known) | 585 | 6.5 min |
| `terminals_distances`, full node matrix (before H1 was known) | 1,113 | 12.4 min |

**Recommendation: `orbits_distances`, 3 calls per game version.** The 3 calls needed were made in the probe, so for 4.10.2 the compilation needs **0 further distance calls**. Cross-system pairs are never requested; they follow from the within-system distances plus the jump edges (70 Gm). Rate limit (120/min) and quota are irrelevant at this volume; the compiler still spaces requests ≈ 0.7 s and backs off on 429 / `requests_limit_reached`.

### 3.2 Coverage per game version

The compiler checks, per system, that every pair of node orbits is present (either direction) and reports the missing ones. 4.10.2: none missing. If a later version has gaps (new stations in Pyro are likely, since Pyro's table is sparse), the options in order of preference are: (1) `terminals_distances` for the missing orbit pair (same data source, so it may also return `data: false`), (2) fill from the shortest path over the known pairs and flag the pair `estimated: true`, (3) fail the compile if more than 5 % of the pairs of a system are estimated.

### 3.3 What MDS really needs

A 2D embedding needs far fewer than all pairs, but here all of them cost nothing: the dense orbit matrix gives the best-constrained fit and the most accurate distance lookups, with no landmark or sparse scheme. (Landmark MDS was costed at 392 `terminals_distances` calls and is obsolete.)

### 3.4 Caching and later game versions

- The raw `orbits_distances` rows are stored **as received** in `tools/terminal-map/raw/<gameVersion>/` and **committed** (≈ 0.9 MB for 3 systems; the 4.10.2 probe file already contains them). The compiler's input is those files plus the metadata (cached in `tools/terminal-map/cache/`, git-ignored, 8 cheap requests), so a recompile (algorithm change, new output shape) makes **0 requests**.
- A new game version costs the **same 3 calls**, no per-pair bookkeeping and no sampling: the endpoint returns the latest reported value for every pair, with its own `game_version` stamp. The compiler records the oldest and the newest row version used per system, so stale data is visible (the 4.10.2 data is mostly from 4.3.2 – 4.7.1).
- `orbits_distances` has a 1-day server cache, so re-running within a day costs UEX nothing either.

## 4. Language, tooling and algorithm

### 4.1 Python in a Docker image

**Python** (numpy), not Node:

- Classical MDS is an eigendecomposition and SMACOF is ~25 lines of matrix algebra; `numpy.linalg.eigh` is exactly the tool. The JS ecosystem has no maintained MDS library (only generic matrix packages), so a Node compiler would hand-roll both on top of `ml-matrix`.
- scikit-learn's `MDS` is not needed: it has no weights or missing-value support (a gap in a future version needs weight 0), and it drags in scipy. A weighted SMACOF is written directly in numpy.
- The compiler is a build-time tool, not app code. A separate image keeps the app's `package.json` / lockfile clean (SPEC §2: only Docker on the host, satisfied) and the app only imports the JSON output.
- Image: pinned `python:3.13.x-alpine` (`tools/terminal-map/Dockerfile`), pinned numpy in `requirements.txt` when the MDS step arrives. Phase 1 needs the standard library only.

### 4.2 Algorithm (per star system)

1. **Points are orbits, not nodes.** Matrix `D` over the distinct orbits of the system's nodes (Stanton 25 × 25), integer Gm from `orbits_distances`. Asymmetric pairs use the mean of both directions, duplicate rows the last one by `date_modified`. A missing pair (§3.2) gets weight 0.
2. **Initialization:** classical (Torgerson) MDS: double-centre `−½ J D² J`, `eigh`, two largest eigenpairs (missing pairs filled with the shortest path for this step only). No randomness, no restarts.
3. **Refinement:** weighted SMACOF (stress majorization) from that start, fixed maximum of 500 iterations, relative tolerance 1e-9. Weight `w_ij = 1 / d_ij` favours the short distances; since the data is rounded to 1 Gm, short pairs carry the largest relative rounding error, so the weighting was compared on the real 4.10.2 data (stress-1 / mean relative error: uniform 0.0080 / 0.0105 Stanton, `1/√d` 0.0080 / 0.0101, `1/d` 0.0083 / 0.0098; Pyro and Nyx differ in the 4th decimal). The differences are negligible, **`1/d` is fixed** (best mean error) and recorded in the file's `generator` block.
4. **Why SMACOF on top of classical MDS:** the data is 3D reported distances projected to 2D, with rounding and occasional stale values. Classical MDS truncates eigenvalues; SMACOF minimises the actual stress.
5. **Nodes from orbits:** every node takes the 2D point of its orbit. Nodes that share an orbit are then spread with the 0.15 Gm rule (§5.3).
6. **Quality metrics** (per system, §5.2): `stress1` (Kruskal stress-1), mean and max relative pair error, `planarShare` = (λ₁+λ₂)/Σ positive λ from the classical step (how 2D the system really is).

### 4.3 Determinism

Same input → byte-identical output:

- No randomness anywhere (deterministic init, fixed iteration count). If one is ever introduced it uses `numpy.random.default_rng(0)`.
- **Canonical frame** per system: translate the centroid to 0, rotate to the principal axes (eigenvectors of the coordinate covariance, ordered by eigenvalue), then fix the signs: each axis is flipped so that Σ x·|x| ≥ 0 (ties → smallest orbit id). That removes MDS's rotation and reflection freedom. Units stay Gm (never normalised), so `‖a − b‖` approximates the distance.
- Stable order: nodes sorted by `(system id, kind rank, numeric id)`, orbits by id, JSON written with sorted keys, compact separators, `\n` line endings, coordinates rounded to 3 decimals (1 Mm) with `-0.0` normalised to `0.0`.
- `OPENBLAS_NUM_THREADS=1`, `PYTHONHASHSEED=0`, base image pinned by digest.
- Float differences between CPU architectures are absorbed by the rounding except for a value on a rounding boundary, so the compiler has **`--check`**: recompile from the committed raw files and fail if the result differs from the committed output. If it ever flaps, the fallback is a pure-stdlib implementation (Jacobi eigensolver + SMACOF; ≤ 25 points per system, < 1 s, only `+ − × ÷ √`, bit-exact everywhere).

## 5. Output data

### 5.1 File and import

Two static files, **not bundled**, served from `public/terminal-map/` and fetched at runtime (`import.meta.env.BASE_URL + 'terminal-map/…'`):

- `public/terminal-map/<gameVersion>.json` (e.g. `4.10.2.json`, ≈ 62 KB): the map of §5.2.
- `public/terminal-map/index.json`: `{"schemaVersion":2,"versions":["4.10.2"]}`, the compiled versions oldest first, so the app picks the LIVE version or the newest older one (marking the map "from 4.10.2") without guessing file names. `--compile` rewrites it from the files present, `--check` verifies it.

The data is static per version, so it needs no TTL, only a `schemaVersion` check (now 2; changes of the shape bump it). The shape is the contract in `src/domain/terminalMap.ts` (types only, no runtime code); the app must not reimplement the travel rules or the shortest paths, it reads `travel`.

### 5.2 Shape

```jsonc
{
  "schemaVersion": 2,
  "gameVersion": "4.10.2",
  "units": "Gm",
  "generator": { "source": "orbits_distances", "weights": "1/d", "maxIterations": 500,
                 "jumpCost": 70, "coOrbitSpread": 0.15, "coOrbitCost": 0.15, "panelGap": 20 },
  "systems": [
    {
      "id": 68, "name": "Stanton",
      "orbitIds": [4, 59, 116, 190, 326],                       // order the indices of `estimated` refer to
      "estimated": [],                                           // [i, j, Gm] pairs without a usable report: distance of the fitted points, flagged
      "layout": { "cx": 0.0, "cy": 0.0, "rotationDeg": 0.0 },   // panel in the combined map (§5.4)
      "quality": { "stress1": 0.0083, "meanRelError": 0.0098, "maxRelError": 0.3108, "planarShare": 0.9728,
                   "pairs": 300, "estimatedPairs": 0, "oldestRowVersion": "4.3.2", "newestRowVersion": "4.7.1" }
    }
  ],
  "nodes": [
    {
      "index": 12,                        // position in `nodes` = row and column in `travel`
      "id": "planet:116", "system": 68, "kind": "planet", "name": "Hurston", "orbitId": 116,
      "group": "planet:116",              // parent planet node, null for standalone nodes (gateways, Nyx stations, Delamar): a group of one
      "terminalIds": [18, 30, 31],
      "hasCommodityTerminal": true,
      "x": 12.345, "y": -3.21,           // system-local, Gm
      "offset": false                    // true: placed by the 0.15 Gm co-orbit rule, not by distance data
    }
  ],
  "jumps": [ { "a": "station:24", "b": "station:50", "cost": 70, "jumpPointIds": [1, 2] } ],
  "terminalNode": { "18": "planet:116" }, // terminal id → node id; a terminal not listed has no node (2 in 4.10.2 have no location)
  "travel": [0, 23.15, 41.0, null /* … */] // N × N, row-major, `travel[from.index * N + to.index]` in Gm, N = nodes.length
}
```

`kind` is `planet | moon | station | orbit`. Coordinates are system-local and metric. The combined-map position of a node is `layout.c + R(layout.rotationDeg) · (x, y)`. The reported orbit distances are not repeated in the file (they are the committed raw input), only the `estimated` pairs that had to be fitted.

**`travel`** is the directed shortest travel distance of §5.4 for every ordered pair of nodes: 3 decimals, `0` on the diagonal (and for two terminals of one node), `null` where unreachable (none in 4.10.2). It is **not symmetric** (entering a group needs its planet, leaving does not). A planetary group is `node.group ?? node.id`; a terminal's star system is `nodes[terminalNode[id]].system`.

### 5.3 Co-orbit spread (needed: confirmed by the probe)

Nodes of one orbit have no distance between them (`data: false`) and identical distances to everything else. The compiler places the group's planet node at the orbit's point and spreads the other nodes of that orbit (moons first, then stations on the same orbit, in id order) on a circle of **radius 0.15 Gm** around it, `offset: true`. The distance between two nodes of one orbit is **0.15 Gm** in the travel graph, so lookups and drawing agree. Largest clusters: 6 nodes (Hurston and Crusader): 5 around the planet, ≥ 0.17 Gm apart. Stations on their own Lagrange or gateway orbit are alone in it and are not moved.

### 5.4 Distances, routes and drawing

- **Distance between two nodes of a system** (travel graph, §2.5): the compiler (`travel.py`) builds the directed edges of the §2.5 table, weighted with the reported orbit distance (the distance of the fitted points where none is usable) or 0.15 Gm for two nodes of one orbit, and solves all pairs with Floyd-Warshall (float64, only `min` and `+`, so the result is deterministic). Two terminals on one node: 0. The result is stored as `travel` (71² = 5,041 numbers); the app only looks it up.
- **Distance across systems:** the same solve over all systems, with the `jumps` edges (cost 70) between gateway nodes. In the triangle the shorter of the direct and the via-third-system path wins.
- **Straight-line estimate** between any two nodes of a system, when only the map is available: `‖p − q‖` of the system-local coordinates.
- **Drawing:** one panel per system, placed on fixed positions in system-id order on a circle (radius = sum of the two largest panel radii + a gap), each rotated by the closed-form angle that best points its gateways at the panels they lead to. Jump edges are straight lines between gateway nodes. Systems are not co-located in reality, so this layout is schematic by design; it is stored in `layout`, separate from the metric coordinates.

### 5.5 Future uses mapped to the data

| Use | Data |
|---|---|
| Distance between two terminals | `terminalNode` → two nodes → `travel[a.index * N + b.index]` (§5.4). Same node → 0. |
| Same planetary group / star system | `node.group ?? node.id`; `node.system`. |
| Terminals along a route | route legs as segments in the system plane: nodes whose point-to-segment distance ≤ ε, expanded to `terminalIds`. Needs only `x`, `y`. |
| 2D drawing | `layout` + `x`, `y` + `jumps` + per-system `quality` as a confidence hint. |

## 6. Open questions and data gaps

Answered by the probe: orbit-derived (yes), symmetric (yes), `orbits_distances` complete for our nodes (yes), terminal independence and straight-line vs travel (moot by decision 1).

1. **Travel rules (§2.5): confirmed by the product owner, all three readings.** (a) member ↔ member inside one group is direct (the rule only says planet → members); (b) "the system can be left from any location" is read as "from any member you can go straight to a planet or gateway of another group" (planetary system, not star system; the graph handles both the same way); (c) the 0.15 Gm spread also covers stations that sit on their planet's orbit, not only moons.
2. **Age of the data:** the orbit rows were reported in game versions 3.24 – 4.10.2 (most 4.3.2 – 4.7.1). If a body moved, old rows are wrong; the compiler reports the oldest version per system and cannot fix it.
3. **Future coverage:** Pyro's table covers only 716 of 903 orbit pairs today (all pairs between our node orbits, but new stations will have gaps); §3.2 lists the fallbacks. In 4.10.2 one pair is unusable: Pyro IV ↔ Pyro V is reported as **0 Gm** (game version 4.7), which cannot be right for two planets. The compiler treats 0 Gm between different orbits as missing, fits the pair from the other 15 distances and lists it in `estimated` (Pyro `estimatedPairs: 1`).
4. **Jump cost** is the constant 70 Gm (`generator.jumpCost`).
5. **Terra Gateway** has no jump partner in 4.10.2 (§2.3); the node stays.
6. **Data quirks** seen: terminal rows with a wrong `id_orbit` (Chawla's Beach), two terminals without any location id, Pyro V is a planet node that only has an item terminal while its moons have commodity terminals, 10 `PYAM-*` stations and `INS Jericho` exist in the metadata without terminals (not nodes).
7. **Scale and resolution:** distances are whole Gm, moon spread is 0.15 Gm, planet-to-planet distances are tens of Gm, so the combined map needs zoom and the moon positions are a display convention, not data.

## 7. Probe (done) and the 4.10.2 result

The probe of 8 calls ran once on 2026-10-29 (`compile.py --probe`: a fixed list that refuses to run twice and the only distance requests the tool can make). Its results are §1.1 and §1.2.

The compiler (phase 2) reads the committed raw files and makes **no API calls**. Result for 4.10.2, `public/terminal-map/4.10.2.json` (62 KB, of which `travel` is about 35 KB):

| System | Nodes | Orbit points | Reported pairs | Estimated | stress-1 | Mean rel. error | Planar share | Row versions |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| Stanton | 42 | 25 | 300 | 0 | 0.0083 | 1.0 % | 97.3 % | 4.3.2 – 4.7.1 |
| Pyro | 22 | 17 | 135 | 1 | 0.0091 | 0.85 % | 97.5 % | 4.3.2 – 4.10.2 |
| Nyx | 7 | 7 | 21 | 0 | 0.0050 | 0.48 % | 99.3 % | 4.4 – 4.7.1 |

The systems are almost exactly planar (97–99 % of the variance in two dimensions), so the 2D map reproduces the reported distances to about 1 %. The largest single error (Stanton 31 %) is a 1 Gm pair (Ita ↔ the HUR Lagrange stations, 0.3 Gm off), where the 1 Gm rounding of the source dominates. Combined layout: the three panel centres sit on a circle at −90° (Nyx), 30° (Pyro) and 150° (Stanton), each panel rotated towards the panels its gateways lead to.

The app side is the contract `src/domain/terminalMap.ts` (types of §5.2, no runtime code); the loader (fetch `index.json`, pick the LIVE version or the newest older one, then fetch that file) lives in the app.

## 8. Tooling in this repo

```bash
docker compose run --rm terminal-map --compile                       # raw/<newest version>/ -> public/terminal-map/<version>.json + index.json (offline)
docker compose run --rm terminal-map --check                         # fail if either committed file differs from a fresh compile (offline)
docker compose run --rm terminal-map-test                            # Python tests (MDS, frame, ring, whole-map checks, determinism)
docker compose run --rm terminal-map --dry-run                       # nodes, groups, request counts of the (old) terminal-pair schemes
docker compose run --rm terminal-map --snapshot --game-version 4.11  # trimmed metadata -> raw/4.11/metadata.json (8 metadata requests)
docker compose run --rm terminal-map --fetch --game-version 4.11     # prints the 3 orbits_distances calls, sends nothing
docker compose run --rm terminal-map --fetch --confirm --game-version 4.11  # makes them -> raw/4.11/orbits_distances.jsonl (once)
```

Files in `tools/terminal-map/`: `compile.py` (CLI, guarded UEX access, probe), `fetch.py` (the `orbits_distances` fetch step), `nodes.py` (metadata snapshot, nodes, groups, jump edges), `mapbuild.py` (distance rows, per-system fit, co-orbit spread, layout, output, index), `travel.py` (travel graph and all-pairs distances), `mds.py` (classical MDS, weighted SMACOF, canonical frame), `test_terminal_map.py`, `raw/<version>/` (committed input: `metadata.json`, `probe.jsonl` with the `orbits_distances` rows), `cache/` (git-ignored scratch). `uex_get` refuses `terminals_distances` / `orbits_distances`; only `probe()` (fixed list) and `fetch.py` (one `orbits_distances` call per star system, only with `--confirm`) may call them.

**For a new game version** (needs the product owner's go-ahead for the 3 distance calls): `--snapshot`, `--fetch` to see the plan, `--fetch --confirm` (stores the raw envelopes once; nothing is written if a call fails; it reports node-orbit pairs without a distance), `--compile`, review `estimated` and `oldestRowVersion`, commit raw and output together. 4.10.2 has no `orbits_distances.jsonl`: its rows are in `probe.jsonl`.

Under Git Bash prefix `docker compose run` with `MSYS_NO_PATHCONV=1` when passing `/work/...` paths.
