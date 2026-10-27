# SC Hauling Companion — Specification v1.0

Status: ready for implementation · Written: 2026-10-27 · Target game version at time of writing: Star Citizen LIVE 4.10.2

This document is the single source of truth for implementing v1.0. It is written for an implementing agent that has no other context. Everything marked **MUST** is required for v1.0; **SHOULD** is expected unless it causes significant cost; **MAY** is optional.

---

## 1. Purpose

Some Star Citizen hauling missions make the player fly a fixed sequence of locations while their ship still has free cargo space. The Hauling Companion uses that free space for speculative commodity trading **along the mission route**:

1. The player enters the ordered list of terminals they will visit.
2. The player selects their ship and the free cargo space (SCU) left after mission cargo.
3. The app computes which commodities can be bought at one stop and sold at a later stop on the route, including trades that skip intermediate stops (A→C instead of A→B→C), and presents several ranked options with buy price, sell price, profit, ROI, legality and container (SCU box) sizes.

Out of scope for v1.0: route ordering/optimization, distances/travel time, mining (raw) materials, items, user accounts, writing data back to UEX.

---

## 2. Tech stack and constraints

| Area | Decision |
|---|---|
| App type | Single-page application, client-side only (no backend) |
| Build | Vite, React, TypeScript (`strict: true`) |
| Versions | Latest stable majors at implementation time (expected: Node 24 LTS, React 19, Vite ≥7, TS ≥5.6). Pin exact versions via `package-lock.json`. |
| State | Zustand (with `persist` middleware → `localStorage`) for user input; plain modules for data/cache |
| Persistence of API data | IndexedDB via `idb-keyval` |
| Styling | Plain CSS with CSS custom properties (CSS Modules or a single global stylesheet). No UI framework. |
| Fonts | Bundled via `@fontsource/*` (no runtime calls to Google Fonts). Suggested: `@fontsource/share-tech-mono` for numerics/labels + `@fontsource/ibm-plex-sans-condensed` for body text. |
| Tests | Vitest + @testing-library/react (jsdom) |
| Lint/format | ESLint (typescript-eslint, react-hooks plugin) + Prettier |
| Host tools | **Only Docker / Docker Compose and git (+ git flow).** No host Node.js, npm or other runtimes may be assumed. Every build, dev, test, lint and scaffold command runs in a container. |

### 2.1 Docker setup (MUST)

Files at repo root:

- `Dockerfile` — multi-stage:
  - `base`: `node:24-alpine` (pin a concrete tag such as `node:24.x.y-alpine` at implementation time), `WORKDIR /app`.
  - `deps`: copy `package.json` + `package-lock.json`, `npm ci`.
  - `dev`: from `deps`, `CMD ["npm","run","dev","--","--host","0.0.0.0"]`, expose 5173.
  - `build`: from `deps`, copy sources, `npm run build`.
  - `runtime`: `nginxinc/nginx-unprivileged:alpine` (pinned tag), copy `dist/` and `docker/nginx.conf`, expose 8080.
- `docker/nginx.conf` — SPA fallback (`try_files $uri /index.html`), long `Cache-Control: immutable` for `/assets/*`, `no-cache` for `index.html`, gzip on.
- `docker-compose.yml` — services:
  - `dev`: build target `dev`, port `5173:5173`, bind mount `.:/app`, **named volume for `/app/node_modules`** (so Windows host never holds node_modules), env `CHOKIDAR_USEPOLLING=true`. Vite config MUST set `server.watch.usePolling` when that env is present (Windows bind mounts don't emit FS events).
  - `test`: same image as `dev`, command `npm run test -- --run`.
  - `lint`: same image, command `npm run lint && npm run typecheck`.
  - `app`: build target `runtime`, port `8080:8080`.
- `.dockerignore` (node_modules, dist, .git).
- `.gitattributes` with `* text=auto eol=lf` (the repo is developed on Windows; container tooling expects LF).
- `.gitignore` (node_modules, dist, coverage, .vite, *.local).

Scaffolding without host Node (PowerShell example):

```powershell
docker run --rm -v "${PWD}:/app" -w /app node:24-alpine sh -c "npm create vite@latest scaffold -- --template react-ts && cp -r scaffold/. . && rm -rf scaffold"
```

Required `package.json` scripts: `dev`, `build` (`tsc -b && vite build`), `preview`, `test` (`vitest`), `lint`, `typecheck` (`tsc -b --noEmit`), `format`.

Standard commands (document these in `README.md`):

```bash
docker compose up dev            # dev server on http://localhost:5173
docker compose run --rm test     # unit tests
docker compose run --rm lint     # lint + typecheck
docker compose up --build app    # production build on http://localhost:8080
```

When dependencies change: `docker compose run --rm dev npm install <pkg>` (updates `package.json`/lockfile on the bind mount), then `docker compose build`.

### 2.2 Git workflow (MUST)

- git flow is initialized. Branches: production = **`master`**, integration = **`develop`**, prefixes `feature/`, `bugfix/`, `release/`, `hotfix/`, version tag prefix **empty** (tags look like `1.0.0`).
- All work happens on feature branches: `git flow feature start <name>` → commits → `git flow feature finish <name>` (merges into `develop`).
- Commit messages follow **Conventional Commits 1.0.0**: `<type>(<optional scope>): <description>`; types `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`. Breaking changes use `!` or a `BREAKING CHANGE:` footer. Suggested scopes: `api`, `cache`, `calc`, `ui`, `route`, `ship`, `results`, `docker`, `theme`.
- Merge commits generated by git flow are exempt from the format.
- **The version number is derived from the commit history (SemVer), never chosen by hand.** Commit types therefore MUST reflect their version impact:

  | Commit | Version bump |
  |---|---|
  | `feat` (user-visible new capability) | minor |
  | `fix`, `perf` | patch |
  | any type with `!` after type/scope, or a `BREAKING CHANGE:` footer | major |
  | `docs`, `style`, `refactor`, `test`, `build`, `ci`, `chore`, `revert` | none |

  One logical change per commit; never hide a user-visible change in `chore`/`refactor`.
- Versioning/changelog tool: **git-cliff**, run from its Docker image (pin a concrete tag, e.g. `orhunp/git-cliff:2.x.y`). A `cliff.toml` at the repo root MUST set:
  - `tag_pattern = "[0-9]+\\.[0-9]+\\.[0-9]+"`, because tags have no `v` prefix;
  - conventional-commit parsing with the bump rules above;
  - grouping into Features / Bug Fixes / Performance in `CHANGELOG.md`.
  
  If the container refuses the repo because of ownership ("dubious ownership"), pass `-e GIT_CONFIG_PARAMETERS="'safe.directory=*'"`.
- Release procedure (example in PowerShell):

  ```powershell
  # 1. derive the next version from commits since the last tag
  $v = docker run --rm -v "${PWD}:/app" -w /app orhunp/git-cliff:<tag> --bumped-version
  git flow release start $v
  # 2. changelog + package.json version (no git tag from npm)
  docker run --rm -v "${PWD}:/app" -w /app orhunp/git-cliff:<tag> --bump -o CHANGELOG.md
  docker compose run --rm dev npm version $v --no-git-tag-version
  git add CHANGELOG.md package.json package-lock.json
  git commit -m "chore(release): $v"
  git flow release finish $v   # tags $v on master, merges back to develop
  ```

  The first release is **1.0.0**. Because no tag exists yet, set `[bump] initial_tag = "1.0.0"` in `cliff.toml`, or pass `--tag 1.0.0` explicitly for that one release; every later version is derived.
- Do not push to any remote unless the user asks.

Suggested feature branch sequence (each ends green on `test` + `lint`):

1. `feature/project-setup` — Docker, Vite scaffold, lint/test tooling, `cliff.toml`, README.
2. `feature/api-client-cache` — §4 and §5.
3. `feature/trade-calculator` — §6 (pure TS, fully unit-tested, no UI).
4. `feature/theme` — §7.1 tokens, base layout, fonts.
5. `feature/setup-and-route-ui` — ship/cargo input and route builder with autocomplete (§7.3, §7.4).
6. `feature/results-ui` — results views (§7.5).
7. `release/1.0.0`.

---

## 3. Domain glossary

| Term | Meaning |
|---|---|
| **Stop** | One entry in the user's route: a commodity terminal at a given position (index 0…n-1). The same terminal may appear more than once. |
| **Segment** | The flight between stop k and stop k+1. |
| **SCU** | Standard Cargo Unit. Prices from UEX are per SCU. |
| **Box / container size** | Cargo containers come in 1, 2, 4, 8, 16, 24, 32 SCU. Terminals sell/accept specific sizes; ships' grids accept specific sizes. |
| **Haul** | One buy-then-sell transaction of one commodity: buy at stop i, sell at stop j > i. If j > i+1 the haul **skips** the stops in between (cargo stays on board). |
| **Plan** | A set of hauls executed on one route run, respecting free cargo space on every segment. |
| **Free SCU (C)** | Cargo space available for trading (ship capacity minus mission cargo). |

---

## 4. Data source: UEX Corp API 2.0

Base URL: `https://api.uexcorp.uk/2.0/` · Docs: <https://uexcorp.space/api/documentation>

Verified on 2026-10-27 by live requests:

- All endpoints below are **public**: no API key, no `Authorization` header.
- CORS: `Access-Control-Allow-Origin: *` → callable directly from the browser.
- Responses are gzip-compressed when `Accept-Encoding: gzip` is sent (browsers do this automatically).
- Rate limit: 120 requests/minute, 172,800/day. This app makes ≤ 5 requests per cold start.
- Envelope: `{ "status": "ok", "http_code": 200, "data": ..., "message": "" }`. Any `status !== "ok"` is an error (e.g. `invalid_type`, `requests_limit_reached`); `http_code` and `message` carry details.
- Numbers are usually JSON numbers but **some endpoints return numeric strings** (e.g. `terminals_distances.distance` is `"6"`). The client MUST coerce every numeric field with `Number()` when mapping and treat `NaN`/`null` as 0/unknown.
- Booleans are `0`/`1` integers → map to `boolean`.
- Data is crowdsourced and can be stale or wrong; the UI MUST surface price age.

### 4.1 Endpoints used

| # | Endpoint | Purpose | Server cache TTL | Raw / gzip size | Client TTL (see §5) |
|---|---|---|---|---|---|
| E1 | `GET /commodities` | Commodity master data (name, legality, raw flag, volatility) | 1 h | 138 KB / 12 KB | 24 h |
| E2 | `GET /terminals?type=commodity` | Commodity trade terminals (location names for autocomplete, max box size) | 12 h | ~200 KB / 21 KB | 24 h |
| E3 | `GET /vehicles` | Ships, cargo SCU, accepted box sizes | 12 h | 583 KB / 68 KB | 24 h |
| E4 | `GET /commodities_prices_all` | All current buy/sell prices at all commodity terminals | 30 min (updated hourly) | 1.07 MB / 78 KB | 30 min |
| E5 | `GET /game_versions` | `{ live, ptu }` — shown in footer and used to invalidate static caches | 24 h | tiny | with static data |

Not used (and why):
- `commodities_prices` (per terminal/commodity) — E4 returns everything in one call; per-terminal calls would multiply requests.
- `commodities_raw_prices*`, `items*` — raw materials and items are explicitly excluded.
- `commodities_routes` — server-side route suggestions are not constrained to the user's ordered stops.
- `terminals_distances` — one call per terminal pair; not needed because route order is fixed by the mission (see §10, future).
- `commodities_status` — static 7-level inventory scale; embedded as a constant (§4.3) to save a request.

### 4.2 Field reference (verified samples)

**E1 `commodities`** (205 records). Fields used:

| Field | Type | Use |
|---|---|---|
| `id` | int | key |
| `name`, `code`, `kind` | string | display (`kind` is free text, inconsistent casing — display only, never filter on it) |
| `is_raw` | 0/1 | **exclude when 1** (raw/ore/unrefined materials; 45 records) |
| `is_illegal` | 0/1 | legality badge/filter (18 records, e.g. WiDoW, SLAM, Maze, E'tam, Neon) |
| `is_volatile_qt` | 0/1 | explodes during quantum travel (currently: Diluthermex) → excluded by default |
| `is_volatile_time` | 0/1 | degrades over time (e.g. Zeta-Prolanide) → warning badge |
| `is_available_live` | 0/1 | exclude when 0 |
| `is_temporary` | 0/1 | event commodity (e.g. Fireworks) → info badge only |

Sample (trimmed): `{"id":1,"name":"Agricium","code":"AGRI","kind":"Metal","is_raw":0,"is_illegal":0,"is_volatile_qt":0,"is_volatile_time":0,"is_available_live":1,"is_temporary":0}`

**E2 `terminals?type=commodity`** (161 records; 114 with `is_available_live=1 && is_visible=1`; systems: Stanton, Pyro, Nyx). Fields used:

| Field | Type | Use |
|---|---|---|
| `id` | int | key |
| `name` | string | unique per terminal, e.g. `"Admin - ARC-L1"`, `"TDD - Trade and Development Division - Area 18"` |
| `nickname` | string | short, e.g. `"ARC-L1"` |
| `displayname` | string | location name shown in-game, e.g. `"ARC-L1 Wide Forest Station"` — **NOT unique** (`Area18` ×3, `Grim HEX` ×2, …) |
| `fullname` | string | e.g. `"Commodity Shop - Admin - ARC-L1"` |
| `code` | string | e.g. `"ARCL1"` |
| `star_system_name`, `planet_name`, `moon_name`, `orbit_name`, `space_station_name`, `city_name`, `outpost_name` | string\|null | autocomplete haystack + secondary display line |
| `max_container_size` | int | largest box the terminal handles; **0 = unknown** (33 terminals) |
| `is_available_live`, `is_visible` | 0/1 | default filter: both 1 |
| `has_loading_dock`, `has_freight_elevator`, `is_auto_load` | 0/1 | MAY show as icons |

**E3 `vehicles`** (283 records, 140 with `scu > 0`). Fields used:

| Field | Type | Use |
|---|---|---|
| `id` | int | key |
| `name_full` | string | display + search, e.g. `"Drake Cutlass Black"` (one duplicate name exists — key by id) |
| `name` | string | short name |
| `scu` | number | cargo capacity |
| `container_sizes` | string | CSV, e.g. `"1,2,4,8,16"`. **May be `""`, `null` or the string `"null"`** (e.g. Hull D, Kraken, Galaxy) → unknown. May contain non-standard values (6, 12) — ignore values not in {1,2,4,8,16,24,32}. |
| `is_concept` | 0/1 | hidden by default (toggle) |
| `is_ground_vehicle`, `is_spaceship` | 0/1 | display only |
| `pad_type` | string\|null | display only |

Sample: `{"id":…, "name_full":"Drake Cutlass Black","scu":46,"container_sizes":"1,2,4,8,16"}`, `"MISC Hull C" scu 4608 "1,2,4,8,16,24,32"`.

**E4 `commodities_prices_all`** (2,580 records, all at `type=commodity` terminals). Each record is **either** a buy offer **or** a sell offer (verified: no record has both `price_buy>0` and `price_sell>0`; at most one record per commodity/terminal pair).

| Field | Type | Meaning / use |
|---|---|---|
| `id_commodity`, `id_terminal` | int | foreign keys |
| `price_buy` | float | last reported price the **player pays** per SCU at this terminal; `>0` ⇒ buy offer |
| `price_sell` | float | last reported price the **player receives** per SCU; `>0` ⇒ sell offer |
| `price_buy_avg`, `price_sell_avg` | float | averages; MAY show as hint, not used for calculation |
| `scu_buy`, `scu_buy_avg` | float | last / average reported SCU available to buy. **Informational only** (see note below). |
| `scu_sell`, `scu_sell_avg` | float | last / average reported SCU on the sell side; semantics undocumented (may be a reported sale amount rather than demand). **0 in 88 % of sell rows. Informational only.** |
| `scu_sell_stock` | float | terminal's reported stock of the commodity (sell side). **Informational only.** |
| `status_buy`, `status_sell` | int 0–7 | inventory level (see §4.3); 0 = not applicable. **Warning source only.** |
| `container_sizes` | string | CSV of box sizes offered/accepted at this terminal for this commodity, e.g. `"1,2,4,8,16,24,32"`, `"8,16,24,32"`, `"1,2"`; `""` ⇒ unknown (13 rows) |
| `date_modified` | unix seconds | price age. Median ~2 days, 90th pct ~8 days at time of writing. |
| `commodity_name`, `terminal_name` | string | denormalized, MAY use |

Sample buy row: `{"id_commodity":…,"id_terminal":…,"commodity_name":"Taranite","terminal_name":"Samson & Son's","price_buy":18792,"scu_buy":41,"scu_buy_avg":54,"status_buy":3,"container_sizes":"1,2,4,8,16,24,32"}`
Sample sell row: `{"commodity_name":"Agricium","terminal_name":"TDD Area 18","price_sell":10000,"scu_sell":14,"scu_sell_avg":14,"scu_sell_stock":2,"status_sell":1,"container_sizes":"1,2,4,8,16,24,32"}`

> **Inventory fields are never used to filter, rank or cap trades.** They come from player reports and lag behind the game's real inventory, which changes continuously. They are shown as warnings only (§6.3, §7.5). Observations from 2026-10-27 that support this:
> - All 1,664 sell rows with `scu_sell = 0` have `status_sell = 1`; rows with `scu_sell > 0` use the full 1–7 range. So `status_sell = 1` together with `scu_sell = 0` is most likely an unreported default.
> - Contradictions exist, e.g. Carbon @ Stanton Gateway (Pyro): `scu_sell_stock = 4608` but `status_sell = 1` ("Out of Stock 0–14 %").
> - 501 of 572 sell rows updated within the last 24 h still have `scu_sell = 0`, so the zeros are not caused by old data.

**E5 `game_versions`**: `{"live":"4.10.2","ptu":"4.10.3"}`

### 4.3 Inventory status scale (embed as constant)

From `GET /commodities_status` (verified). Codes 1–7, same ranges for both sides; meaning differs. Used **only** to show labels and warnings — never to filter (see note in §4.2):

| Code | Buy side (`status_buy`) | Sell side (`status_sell`) |
|---|---|---|
| 1 | Out of Stock (0–14 %) — **warning** `NO STOCK?` | Out of Stock / empty — terminal wants it (only shown when `scu_sell > 0`, otherwise treat as unreported) |
| 2 | Very Low (15–28 %) — **warning** `LOW STOCK?` | Very Low |
| 3 | Low (29–43 %) | Low |
| 4 | Medium (44–57 %) | Medium |
| 5 | High (58–71 %) | High |
| 6 | Very High (72–85 %) | Very High — **warning** `LOW DEMAND?` |
| 7 | Maximum / full | Maximum, No Demand — **warning** `NO DEMAND?` |

Abbreviations for compact UI: OS, VL, LO, ME, HI, VH, MA (buy) / ND (sell 7).

---

## 5. Data layer and caching (minimize API calls)

### 5.1 Module layout

```
src/api/uexClient.ts     fetch wrapper: base URL, envelope check, typed errors, AbortSignal, 15 s timeout
src/api/mappers.ts       raw → domain types (numeric coercion, 0/1 → boolean, CSV → number[])
src/api/cache.ts         IndexedDB-backed TTL cache (idb-keyval)
src/api/dataStore.ts     loadStaticData(), loadPrices(force?) — orchestrates cache + client
src/domain/types.ts      Commodity, Terminal, Vehicle, PriceOffer, …
```

Store **mapped, trimmed** domain objects (only fields in §4.2), not raw responses.

### 5.2 Cache rules

Cache entry: `{ key, schemaVersion, fetchedAt (ms), gameVersion, data }`.

| Dataset | Keys | TTL | Refresh trigger |
|---|---|---|---|
| Static: commodities, terminals, vehicles, game version | `static:v1` (single entry, fetched together) | 24 h | expired, `schemaVersion` changed, or user taps "Reload all data" |
| Prices | `prices:v1` | 30 min | expired **and** the user opens/recomputes results, or user taps "Refresh prices" |

Behavior:

- **Stale-while-revalidate**: if a cached entry exists, render with it immediately; if expired, refetch in the background and recompute when it arrives. Show "prices updated HH:MM · age" in the results header.
- Static refresh fetches E1, E2, E3, E5 in parallel (4 requests). If E5's `live` differs from the cached `gameVersion`, also force a price refresh.
- No polling, no refetch while `document.visibilityState === "hidden"`.
- Manual "Refresh prices" is disabled for 60 s after a fetch (server data won't change faster than its 30 min cache anyway).
- On network/API error: keep using cached data, show a non-blocking banner ("Offline — showing data from …"). If there is no cache at all, show a blocking error with a Retry button.
- Expected call budget: cold start 5 requests; warm start within TTL 0; typical session ≤ 1 per 30 min.
- If IndexedDB is unavailable (private mode), fall back to in-memory cache; app must still work.

### 5.3 Derived indexes (built once per dataset load, memoized)

- `commodityById: Map<number, Commodity>`
- `terminalById: Map<number, Terminal>`
- `buyOffers: Map<terminalId, PriceOffer[]>` and `sellOffers: Map<terminalId, Map<commodityId, PriceOffer>>`
- `terminalSearchIndex`: per terminal, a normalized haystack string (see §7.4).

---

## 6. Trade calculation (pure functions in `src/calc/`, no React)

### 6.1 Inputs

```ts
interface CalcInput {
  stops: number[];            // terminal ids in route order, length 2..10
  freeScu: number;            // C, integer ≥ 1
  shipBoxSizes: number[] | null; // from vehicle, null = unknown
  maxBoxOverride: number | null; // user-chosen max box size (1..32) or null
  options: {
    includeIllegal: boolean;          // default true (illegal hauls are badged)
    includeVolatileQt: boolean;       // default false
    maxPriceAgeDays: number | null;   // default null (no filter); ages are always shown
  };
}
```

Reported inventory (`scu_*`, `status_*`) is deliberately **not** an input to any filter, cap or ranking. It only produces warnings (§6.3).

### 6.2 Eligibility of a commodity

A commodity is eligible iff `!isRaw && isAvailableLive` and the option filters above allow it.

### 6.3 Candidate haul generation

For every pair of stop indices `i < j` and every commodity `c` with a buy offer at `stops[i]` and a sell offer at `stops[j]`:

- `unitBuy = price_buy(i,c)`, `unitSell = price_sell(j,c)`, `margin = unitSell − unitBuy`. Skip if `margin ≤ 0`.
- `cap = floor(C)`. Reported inventory never reduces it.
- **Inventory warnings** (informational, the haul stays in every result set):
  - `noStock` if `status_buy = 1`; `lowStock` if `status_buy = 2`.
  - `noDemand` if `status_sell = 7`; `lowDemand` if `status_sell = 6`.
  - Also carry the raw values for display: `scu_buy` (fallback `scu_buy_avg`), `scu_sell_stock`, and `scu_sell` only when `> 0`. A `status_sell` of 1 is shown only when `scu_sell > 0` (otherwise it is an unreported default, see §4.2).
- **Allowed box sizes** `B = STD ∩ rowSizes(i,c) ∩ shipSizes ∩ {s ≤ maxBox} ∩ {s ≤ terminal(stops[j]).maxContainerSize if > 0}` where
  - `STD = {1,2,4,8,16,24,32}`,
  - `rowSizes(i,c)` = the buy row's `container_sizes`; if empty → `{s ∈ STD : s ≤ terminal(stops[i]).maxContainerSize}` (or all STD if that is 0) and flag `boxSizesUnknown`,
  - `shipSizes` = vehicle sizes; if null → STD and flag `shipBoxSizesUnknown`,
  - `maxBox` = `maxBoxOverride ?? max(shipSizes) ?? 32`.
  - If `B` is empty → haul is **not possible with this ship**; drop it (count dropped hauls and show "N trades need bigger boxes than your ship takes").
- `qtyMax = maxFillable(cap, B)` — the largest integer ≤ `cap` that is a non-negative integer combination of sizes in `B` (unbounded-knapsack reachability DP, O(cap·|B|); cap ≤ ~12,000). If 0 → drop.
- Also compute a **box breakdown** for display: greedy largest-first decomposition of the quantity (valid because DP already proved representability; if greedy fails, use the DP backtrack).

Store per candidate: commodity, i, j, unitBuy, unitSell, margin, qtyMax, B, statuses and reported SCU values (display only), price ages (both rows), flags (`illegal`, `volatileTime`, `temporary`, `noStock`, `lowStock`, `noDemand`, `lowDemand`, `boxSizesUnknown`, `shipBoxSizesUnknown`, `stale` if either row older than 7 days).

### 6.4 Metrics (per haul, for a chosen quantity q)

- `investment = unitBuy × q`
- `revenue = unitSell × q`
- `profit = revenue − investment`
- `roi = profit / investment` (display as %, 1 decimal)
- `profitPerScu = margin`
- `skips = j − i − 1` (number of stops passed without selling)

### 6.5 Result sets ("multiple options")

The calculator returns two result sets.

**A. Single hauls** — every candidate at `q = qtyMax`, sorted by profit desc (user can re-sort by ROI, margin, investment). This list naturally contains skip options (A→C next to A→B and B→C). Hauls with inventory warnings are **not** removed or demoted; they carry warning badges.

**B. Plans** — a plan is a sequence of non-overlapping **loads**. A load is what is carried from stop i to stop j.

1. **Build one load per stop pair (i, j), i < j** — fill the free space greedily:
   - Sort the candidates for (i, j) by margin, highest first.
   - Set `remaining = C`.
   - For each candidate in that order, take `q = maxFillable(remaining, B)`; if `q > 0`, add it to the load and subtract it from `remaining`. Stop when `remaining = 0`.
   - Usually a load is a single commodity. A second commodity is added only when box granularity leaves space unused (example: 46 SCU free, best commodity only in 8/16 boxes → 40 SCU of it plus 6 SCU of the next best).
   - The load's profit is the sum of its parts.
2. **Choose loads with dynamic programming over stops** — a load ends at the stop where the next one begins, or later:

```
best[0] = {∅}
best[k] = topK( best[k−1]  ∪  { p + load(i,k) : i < k, p ∈ best[i] } )
```
   Keep the **top K = 5** distinct plans per stop by total profit. The output is `best[n−1]`, excluding the empty plan; the first one is labelled **MAX**.
3. **Why this is optimal:** inventory is not a constraint, so the whole free space always goes to the best-margin load, and splitting space between overlapping loads never beats the DP. This holds up to box-granularity rounding, which is accepted for v1. No flow solver is needed.
4. **Correctness test** (MUST be a unit test, because greedy fails it): stops A, B, C, C = 100 SCU, candidates X: A→C margin 10, Y: A→B margin 8, Z: B→C margin 8. Expected MAX = Y + Z = 1,600 aUEC, not X = 1,000. Plan #2 = X = 1,000.

Run the calculation in `useMemo`. Expected input is ≤ 10 stops × ~60 commodities, so a Web Worker is not needed.

**Per plan** compute: total profit, total investment, overall ROI (`Σprofit / Σinvestment`), **peak SCU** on board (max over segments), **capital required** (simulate cash: at each stop sell first, then buy; capital required = −min(running cash)), number of transactions, oldest price age, aggregated flags.

**Same terminal twice**: stops are positions, so a terminal visited twice is treated as two independent stops.

### 6.6 Execution timeline (per plan)

Convert a plan to a stop-by-stop checklist for the in-game view (values below are illustrative, not real prices):

```
Stop 1  ARC-L1 Wide Forest Station (Admin - ARC-L1)
  BUY   46 SCU  Laranite        @ 2,810   = 129,260   boxes 2×16, 1×8, 1×4, 1×2
Stop 2  …   (no trade — pass through, 46 SCU on board)
Stop 3  …
  SELL  46 SCU  Laranite        @ 3,315   = 152,490   +23,230
```

---

## 7. User interface

### 7.1 Visual design — "night cockpit"

Dark UI with amber highlights, modeled on night-lit commercial avionics: near-black panels, amber primary information, dim amber secondary, very sparing use of red for warnings. No pure white anywhere. Define as CSS custom properties on `:root`:

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0a0907` | page background |
| `--panel` | `#13110c` | cards/panels |
| `--panel-raised` | `#1c1910` | inputs, selected rows |
| `--line` | `#3a2e14` | borders, dividers |
| `--amber` | `#ffb000` | primary values, active elements, focus ring |
| `--amber-bright` | `#ffc94d` | key numbers (profit) |
| `--amber-dim` | `#b07a10` | labels, secondary text |
| `--amber-faint` | `#5c420c` | disabled, placeholders |
| `--warn` | `#ff6a3d` | ILLEGAL badge, errors, stale data |
| `--ok` | `#d6c36a` | positive/OK status (a desaturated yellow-green; stays within the amber family) |

- Typography: monospace (`Share Tech Mono` or similar) for all numbers, labels in uppercase with `letter-spacing: 0.08em`; tabular numerals (`font-variant-numeric: tabular-nums`). Base size 16 px (prevents iOS zoom on input focus).
- Subtle glow on primary numerals: `text-shadow: 0 0 6px rgba(255,176,0,.35)`; no animations beyond 150 ms transitions; respect `prefers-reduced-motion`.
- `color-scheme: dark`; `<meta name="theme-color" content="#0a0907">`.
- Contrast: all text ≥ WCAG AA against its background (amber-dim on panel must be checked; adjust if below 4.5:1 for body text).

### 7.2 Layout

- Mobile-first, designed for **360–820 px** width (phones and small tablets, portrait and landscape). At ≥ 900 px the content is centered with max-width 820 px (desktop works but is not optimized).
- No horizontal page scroll at 360 px. Tables become stacked cards below 600 px.
- Touch targets ≥ 44×44 px; primary actions reachable by thumb (bottom area).
- Three views switched by a **bottom tab bar**: `SHIP` · `ROUTE` · `TRADES`. The selected tab and all inputs persist across reloads (Zustand `persist`, key `shc:v1`).
- Header strip: app name "HAULING COMPANION", data status pill (e.g. `PRICES 12m · LIVE 4.10.2`), refresh icon button.
- Footer (in SHIP view): "Data: UEX Corp (uexcorp.space) · community-sourced, may be inaccurate · Not affiliated with Cloud Imperium Games."

### 7.3 SHIP view

- **Ship** combobox: searches `name_full` (same matching rules as §7.4). Shows vehicles with `scu > 0`; toggle "Show concept ships" (default off). Option line: `Drake Cutlass Black` / secondary `46 SCU · boxes ≤16`.
- **Free cargo (SCU)** numeric input with − / + steppers (step 1, long-press accelerates) and quick buttons `25 %`, `50 %`, `75 %`, `100 %` of ship SCU. Defaults to ship SCU when a ship is chosen. Clamp to 1…ship SCU (if no ship chosen: 1…100,000).
- **Max box size** segmented control `1 2 4 8 16 24 32`, preselected from the ship's largest accepted size; if the ship's sizes are unknown show "Box sizes for this ship unknown — choose the largest box that fits" and preselect 32.
- **Filters**: toggles for Include illegal (on) and Include quantum-volatile (off). There are deliberately **no** stock/demand filters; reported inventory only produces warnings.
- Data controls: "Refresh prices", "Reload all data" (with timestamps).

### 7.4 ROUTE view

- Ordered list of stops (2–10). Each row: position number, terminal display (primary: `displayname`, secondary: `name · star_system_name` — the secondary line is required because `displayname` is not unique), drag handle (pointer + touch reorder; MUST also provide up/down buttons for accessibility), remove button.
- "Add stop" field at the bottom = **autocomplete**:
  - Source: terminals from E2 with `is_available_live && is_visible` (toggle "show unavailable terminals").
  - Haystack per terminal: `name, nickname, displayname, fullname, code, space_station_name, city_name, outpost_name, moon_name, planet_name, orbit_name, star_system_name`, lower-cased and diacritics-stripped (`normalize('NFD').replace(/\p{Diacritic}/gu,'')`), with `-`, `_`, `.` and `'` treated as spaces so `"arc l1"`, `"arcl1"` and `"ARC-L1"` all match.
  - Matching: split query into tokens; a terminal matches if **every** token is a substring of the haystack (also try the haystack with spaces removed so `"area18"` matches `"Area 18"`).
  - Ranking: exact `code`/`nickname` match > `displayname`/`nickname` prefix > word-start match > substring; tie-break alphabetical by `displayname`. Show max 12 results.
  - Results show as an overlay list above the on-screen keyboard; keyboard support (↑ ↓ Enter Esc) on desktop. Selecting adds the stop and clears the input (focus stays to add the next).
  - Start filtering at 1 character; no network calls (all local).
- "Clear route" with confirmation; "Reverse route" button.
- A sticky bottom button "CALCULATE TRADES →" switches to TRADES (calculation is also live/automatic whenever inputs change).

### 7.5 TRADES view

- Summary header: route (`ARC-L1 → Area18 TDD → …`), free SCU, ship, data age.
- Empty/insufficient states: fewer than 2 stops → hint linking to ROUTE; no profitable trades → "No profitable trades along this route" + count of dropped trades by reason (box size, illegal filter, volatile filter, price-age filter).
- **Plans** section (result set B): horizontal chips `MAX`, `#2`, `#3`, … Selecting a chip shows:
  - KPI row: **Profit** (largest, `--amber-bright`), ROI %, Investment, Capital required, Peak SCU / C.
  - Execution timeline (§6.6), one card per stop, BUY/SELL lines, "pass through" stops shown collapsed with on-board SCU.
  - Badges per haul: `ILLEGAL` (`--warn`), `SKIPS 1` (amber outline), `STALE 9d`, `VOLATILE` (time).
  - Inventory warnings (`--warn` outline, with a question mark because the data is reported, not live): `NO STOCK?`, `LOW STOCK?`, `NO DEMAND?`, `LOW DEMAND?`. Tapping a badge shows the reported values and their age, e.g. "Reported 9 h ago: stock Out of Stock (0–14 %), 0 SCU. Inventory may have refilled since." A plan containing such a haul shows a warning count in its chip (e.g. `#2 ⚠1`).
- **Single hauls** section (result set A): sort selector (Profit, ROI, Margin/SCU, Investment); each card shows:
  - Commodity name + legality badge
  - `Stop i → Stop j` with terminal short names, `SKIPS n` badge when j > i+1
  - Buy price/SCU, sell price/SCU, margin/SCU
  - Quantity SCU (`of C`), allowed box sizes (e.g. `□ 1·2·4·8·16`), box breakdown
  - Investment, profit, ROI
  - Reported inventory status and SCU values (labelled "reported"), inventory warnings, price ages
  - Paginate/virtualize after 30 items ("Show more").
- Number format: `en-US` grouping (`1,234,567`) with unit `aUEC`; on narrow cards MAY use compact (`1.23M`) with full value in `title`/expand. Percentages 1 decimal.
- All results recompute synchronously (memoized) on any input change; no "calculate" round-trip to the API.

### 7.6 Accessibility and robustness

- Semantic HTML, labelled inputs, combobox ARIA pattern for autocomplete, focus visible (amber ring).
- Works offline after first load (data from cache) — a service worker/PWA is **MAY** (not required).
- Handle API schema surprises defensively: unknown/missing fields must not crash; drop malformed records and `console.warn` once per dataset.

---

## 8. Acceptance criteria (v1.0)

1. `docker compose up dev` serves the app on :5173 with hot reload on a Windows host; `docker compose run --rm test` and `docker compose run --rm lint` pass; `docker compose up --build app` serves the production build on :8080. No host Node required.
2. First load performs at most 5 API requests (E1–E5); reload within 30 min performs 0; after 30 min opening TRADES performs exactly 1 (E4). Verified via the browser network panel and a unit test with a mocked `fetch`.
3. Typing `arc l1`, `ARCL1`, `wide forest` or `area18` in the stop field shows the corresponding terminals; duplicates of a `displayname` are distinguishable by the secondary line.
4. Selecting a ship sets free SCU and max box; changing free SCU or max box immediately updates all results.
5. Raw commodities (`is_raw = 1`) and items never appear. Illegal commodities are badged and can be hidden.
6. Single-hauls list includes skip options (i → j with j > i+1) with a `SKIPS n` badge.
7. Hauls whose allowed box set is empty for the chosen ship are excluded and counted.
8. Quantities never exceed free SCU on any segment (unit-tested for plans) and are representable by allowed box sizes.
9. The greedy counter-example in §6.5 yields 1,600 for MAX and 1,000 for #2.
10. Every displayed haul shows buy price, sell price, profit, ROI, legal/illegal, quantity, box sizes, and price age.
11. Layout has no horizontal scroll at 360 px width; all touch targets ≥ 44 px; dark amber theme as in §7.1.
12. Unit-test coverage for `src/calc/**` and `src/api/mappers.ts` ≥ 90 % lines.
13. Reported inventory never removes, caps or re-ranks a trade: a haul whose buy row has `status_buy = 1` and `scu_buy = 0` still appears with full `qtyMax` and a `NO STOCK?` badge (unit-tested).

### 8.1 Required unit tests (minimum)

- `mappers`: numeric strings, `"null"`/`""` CSV handling, 0/1 booleans, ignoring non-standard box sizes.
- `maxFillable`: `(46,{1,2,4,8,16}) = 46`, `(46,{8,16}) = 40`, `(7,{8,16}) = 0`, `(30,{24}) = 24`.
- Candidate generation: excludes raw, non-positive margin, empty box sets; inventory statuses only set warning flags (never exclude or cap).
- Loads: greedy fill of leftover space when box granularity leaves a gap (46 SCU, best commodity in {8,16} → 40 + 6 of next best).
- Plan DP: §6.5 counter-example; non-overlap; top-K ordering and distinctness; skip handling; segment capacity never exceeded.
- Capital-required simulation.
- Cache: TTL expiry, stale-while-revalidate, gameVersion invalidation, IndexedDB-unavailable fallback (mock).
- Autocomplete ranking and tokenization cases from criterion 3 (use small fixture terminals).

Test fixtures: create small hand-written JSON fixtures in `src/__fixtures__/` shaped like §4.2 samples. Do **not** hit the live API in tests.

---

## 9. Gap analysis — is this enough for a hands-off implementation?

### 9.1 Verified (no gaps)

| Requirement | Covered by | Status |
|---|---|---|
| Public API, no key | E1–E5 tested live without auth | ✅ |
| Browser access (CORS) | `Access-Control-Allow-Origin: *` on all used endpoints | ✅ |
| Terminal list + partial-match search | E2 has name/nickname/displayname/code/location names | ✅ |
| Buy price, sell price per terminal | E4 `price_buy` / `price_sell` per SCU | ✅ |
| Profit / ROI | Derived (§6.4) | ✅ |
| Legal / illegal | E1 `is_illegal` | ✅ |
| Commodities only (no raw, no items) | E1 `is_raw`; E4 only covers `type=commodity` terminals; items live in separate endpoints that are not used | ✅ |
| SCU box sizes | E4 `container_sizes` per offer, E2 `max_container_size`, E3 `container_sizes` | ✅ (with gaps below) |
| Ship selection + capacity | E3 `scu`, `container_sizes` | ✅ |
| Skip locations / multiple options | Algorithm §6.5 | ✅ |
| Few API calls / caching | 5 calls cold, server TTLs known (§4.1) | ✅ |
| Docker-only build | §2.1 | ✅ |

### 9.2 Data gaps and how the spec handles them

| Gap | Impact | Handling in spec |
|---|---|---|
| Reported inventory (`scu_buy`, `scu_sell`, `scu_sell_stock`, `status_*`) lags behind the game and is partly contradictory; `scu_sell` is 0 in ~88 % of sell rows and its semantics are undocumented | Trades may hit empty stock or full demand in game | **Product decision:** inventory never filters or caps; shown as `NO/LOW STOCK?` and `NO/LOW DEMAND?` warnings with reported values and age. The player checks the terminal in game. |
| 13 price rows with empty `container_sizes`; 33 terminals with `max_container_size = 0` | Box filtering uncertain | Fallback chain in §6.3 + `boxSizesUnknown` flag |
| ~15 cargo ships (Hull D/E, Kraken, Galaxy, Idris-P …) have no `container_sizes` | Can't infer max box | Max-box override control, defaults to 32 with notice |
| Ship cargo grids are physical 3D grids; a total SCU can't always be packed with any box mix | Plans may be slightly optimistic | Out of scope; box override lets the user be conservative |
| Prices are crowdsourced; median age ~2 days, some > 2 weeks | Profit estimates may be wrong | Always show age; `STALE` badge > 7 days; optional max-age filter |
| `kind` field is inconsistent (`Man-made` vs `Man-Made`, `Minteral`) | None (not used for logic) | Display only |
| Numeric fields sometimes strings | Possible bugs | Mandatory coercion in mappers |
| No travel distance/time in v1 | Can't compute profit/hour | Not required for v1 (route order is fixed by the mission); `terminals_distances` exists if needed later |
| No trade tax/fees modelled | Profit overstated if the game adds fees | None in current game mechanics known to the spec author; out of scope |

### 9.3 Assumptions made (decide-by-default; change if the product owner disagrees)

1. **Stops are terminals**, not locations. A station with several commodity terminals requires picking the terminal. (Alternative: let a stop be a location and merge all its commodity terminals.)
2. **One free-SCU value** for the whole route. Real missions often load/unload mission cargo along the way, which changes free space per segment. The DP in §6.5 extends easily: build `load(i,j)` with the smallest free space over segments i…j−1 instead of C. That makes a per-segment override a small v1.1 addition.
3. **No aUEC budget limit**. Plans show "capital required" instead of constraining it.
4. **Illegal commodities included by default** (badged).
5. **Quantum-volatile commodities excluded by default**, because a hauling route always involves quantum travel.
6. Deployment target is the local `app` container only (no hosting/CI defined).

### 9.4 Verdict

All information required by the stated v1.0 feature set is available from public, key-less UEX endpoints, reachable from the browser, in 5 requests. The remaining uncertainties are data-quality issues (reported inventory, some box-size data), not missing data, and the spec defines a deterministic handling for each. With the assumptions in §9.3 the spec is implementable hands-off.

---

## 10. Future (not v1.0)

- Per-segment free SCU (mission cargo pickup/drop-off).
- Location-level stops (merge terminals at the same station/city).
- Travel distance and profit/hour via `terminals_distances` (cached per pair).
- aUEC budget constraint.
- Optional user-entered stock/demand caps observed at the terminal ("only 20 SCU available here"). This would make plans capacity-constrained per offer; plan optimization would then need a min-cost-flow formulation instead of the DP in §6.5.
- PWA install + offline shell.
- Share route via URL (encode terminal ids).
