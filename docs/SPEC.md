# SC Hauling Companion — Specification v1.0

Status: revision 2, ready for implementation · Written: 2026-10-27 · Revised: 2026-10-28 · Target game version at time of writing: Star Citizen LIVE 4.10.2

This document is the single source of truth for implementing v1.0. It is written for an implementing agent that has no other context. Everything marked **MUST** is required for v1.0; **SHOULD** is expected unless it causes significant cost; **MAY** is optional.

### Revision history

**Revision 10 (2026-10-29)** — skip lines are compared with the best chain of trades via the skipped stops: calculation in §6.6, a verdict row on the collapsed line and the chain's legs in the details (§7.5), acceptance criterion 16, tests (§8.1).

**Revision 9 (2026-10-28)** — deployment to GitHub Pages on every push to `master` (§2.1, §9.3): `check` and `dist` Docker stages, `BASE_PATH` build arg mapped to Vite `base`.

**Revision 8 (2026-10-28)** — full screen toggle button in the header strip (§7.2) and acceptance criterion 15.

**Revision 7 (2026-10-28)** — the chevron in the Details button is an inline SVG, vertically centered with the label, instead of a text glyph that sat off-center (§7.5).

**Revision 6 (2026-10-28)** — the details button returns, now as a bordered, labelled `DETAILS ⌄` button in normal flow at the right of row 1 (§7.5):
- Badges move to row 2.
- Details open and close independently of "bought". Revision 5 tied them together, so a bought line couldn't be collapsed without unmarking it.
- The revision 5 dropdown spacing stays.

**Revision 5 (2026-10-28)** — the details chevron on option lines is removed, because it was unclear and overlapped the profit. Bought lines now show their details automatically, and lines that can't be marked expand on tap (§7.5, §7.6). Dropdown chevrons get proper inner spacing (§7.7).

**Revision 4 (2026-10-28)** — **trip mode** (§7.6):
- Tap a line at the current stop to mark it as bought (light-green highlight + ✓). Details move to a separate chevron button.
- `DEPART →` button: top-right of the stop header on wide screens, under the list on mobile. Departing collapses the stop and turns bought lines into sell reminders at their sell stops. Undo is available for the last departure.
- `COMPLETE ROUTE ✓` after the last stop clears the stops and opens ROUTE.
- Changes in §7.1 (`--sel`, `--sel-bg` tokens), §7.5 (line interaction), §8 (criterion 14, tests).

**Revision 3 (2026-10-28)** — buy and sell price per SCU are shown on the collapsed option line, not only when expanded (§7.5, §8 criterion 10). The sell stop's short name is the terminal `nickname`, as already implemented.

**Revision 2 (2026-10-28)** — product owner review of the first implementation, merged with the implementer's report:

| Area | Change | Section |
|---|---|---|
| Tooling | Latest language versions win over tooling: TypeScript 7; ESLint/typescript-eslint replaced by **oxlint** | §2, §2.1 |
| Tooling | `cliff.toml` tag pattern as TOML literal string with `[.]` | §2.2 |
| Data | A new LIVE game version expires cached prices (stale-while-revalidate), no forced refresh | §5.2 |
| Calc | Box size is a **min–max range** (no more loading hundreds of 1-SCU boxes); sell row's `container_sizes` also constrain boxes | §6.1, §6.3 |
| Calc / UI | **Plans removed.** TRADES now lists, under each stop, the commodities to buy there ranked by profit, each line naming its sell stop | §6.5, §7.5 |
| UI | Amber shifted towards warm white (747 night lighting) | §7.1 |
| UI | Placeholders use `--amber-dim`; `--amber-faint` only for disabled controls | §7.1 |
| UI | Sticky CALCULATE TRADES button centered in the content column at all widths | §7.2, §7.4 |
| UI | Route stop secondary line shows planet · moon · system instead of repeating the name | §7.4 |
| UI | Badges are small, non-interactive chips; the trade line is the touch target | §7.5 |
| UI | Allowed box sizes shown next to every commodity | §7.5 |
| Defaults | Free SCU = 32 without a ship; "Investment" sorts descending | §7.3, §7.5 |

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
| Versions | Latest stable versions of languages, runtimes and frameworks (at revision 2: **TypeScript 7**, Node 24 LTS, React 19, Vite 8). Pin exact versions via `package-lock.json`. **Language and runtime versions take priority over tooling:** if a tool (linter, formatter, plugin) does not support the latest language version, replace the tool; never downgrade the language to keep a tool. |
| State | Zustand (with `persist` middleware → `localStorage`) for user input; plain modules for data/cache |
| Persistence of API data | IndexedDB via `idb-keyval` |
| Styling | Plain CSS with CSS custom properties (CSS Modules or a single global stylesheet). No UI framework. |
| Fonts | Bundled via `@fontsource/*` (no runtime calls to Google Fonts). Suggested: `@fontsource/share-tech-mono` for numerics/labels + `@fontsource/ibm-plex-sans-condensed` for body text. |
| Tests | Vitest + @testing-library/react (jsdom) |
| Lint/format | **oxlint** (no dependency on the TypeScript compiler API) with the `typescript`, `react`, `react-hooks`, `jsx-a11y` and `vitest` plugins and the `correctness` + `suspicious` categories as errors. Use type-aware rules (`oxlint --type-aware` with `oxlint-tsgolint`) if they work with TS 7, otherwise lint without them. Type checking is done by the TS 7 compiler (`typecheck` script). Formatting: Prettier, as long as it parses all TS 7 syntax used; otherwise replace it with oxfmt. Remove ESLint, typescript-eslint and their plugins/configs completely. |
| Host tools | **Only Docker / Docker Compose and git (+ git flow).** No host Node.js, npm or other runtimes may be assumed. Every build, dev, test, lint and scaffold command runs in a container. |

### 2.1 Docker setup (MUST)

Files at repo root:

- `Dockerfile` — multi-stage:
  - `base`: `node:24-alpine` (pin a concrete tag such as `node:24.x.y-alpine` at implementation time), `WORKDIR /app`.
  - `deps`: copy `package.json` + `package-lock.json`, `npm ci`.
  - `dev`: from `deps`, `CMD ["npm","run","dev","--","--host","0.0.0.0"]`, expose 5173.
  - `check`: from `deps`, copy sources, `npm run lint && npm run typecheck && npm run test -- --run`.
  - `build`: from `deps`, copy sources, `npm run build`. Build arg `BASE_PATH` (default `/`) becomes Vite's `base`.
  - `dist`: `FROM scratch` with only `dist/`, for `docker build --target dist --output type=local,dest=dist .`.
  - `runtime`: `nginxinc/nginx-unprivileged:alpine` (pinned tag), copy `dist/` and `docker/nginx.conf`, expose 8080.
- `docker/nginx.conf` — SPA fallback (`try_files $uri /index.html`), long `Cache-Control: immutable` for `/assets/*`, `no-cache` for `index.html`, gzip on.
- `docker-compose.yml` — services:
  - `dev`: build target `dev`, port `5173:5173`, bind mount `.:/app`, **named volume for `/app/node_modules`** (so Windows host never holds node_modules), env `CHOKIDAR_USEPOLLING=true`. Vite config MUST set `server.watch.usePolling` when that env is present (Windows bind mounts don't emit FS events).
  - `test`: same image as `dev`, command `npm run test -- --run`.
  - `lint`: same image, command `npm run lint && npm run typecheck`.
  - `app`: build target `runtime`, port `8080:8080`.
- `.dockerignore` (node_modules, dist, .git).
- `.github/workflows/pages.yml` — on push to `master` (and manual dispatch): `actions/configure-pages`, `docker build --target check`, `docker build --target dist` with `BASE_PATH` = Pages base path + `/`, then `upload-pages-artifact` + `deploy-pages`. CI uses the same Dockerfile as local development, no runner-installed Node.
- `.gitattributes` with `* text=auto eol=lf` (the repo is developed on Windows; container tooling expects LF).
- `.gitignore` (node_modules, dist, coverage, .vite, *.local).

Scaffolding without host Node (PowerShell example):

```powershell
docker run --rm -v "${PWD}:/app" -w /app node:24-alpine sh -c "npm create vite@latest scaffold -- --template react-ts && cp -r scaffold/. . && rm -rf scaffold"
```

Required `package.json` scripts: `dev`, `build` (typecheck with the TS 7 compiler, then `vite build`), `preview`, `test` (`vitest`), `lint` (`oxlint`), `typecheck` (TS 7 compiler in no-emit/build mode over all tsconfig projects), `format`.

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
  - `tag_pattern = '[0-9]+[.][0-9]+[.][0-9]+'` (TOML literal string; an escaped `\\.` in a basic string failed to parse), because tags have no `v` prefix;
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
| **Buy option** | One line in the TRADES view: a haul listed under its buy stop, naming its sell stop. |
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
- Static refresh fetches E1, E2, E3, E5 in parallel (4 requests). Cached prices are tagged with the game version they were fetched under; if E5's `live` differs, the cached prices count as expired and go through stale-while-revalidate (old prices shown, refetched in the background, results recomputed). This does not bypass the manual-refresh cooldown.
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
  boxRange: { min: number; max: number }; // user-chosen box size range, values from STD (1..32), min ≤ max
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
- **Inventory warnings** (informational, the haul is always listed):
  - `noStock` if `status_buy = 1`; `lowStock` if `status_buy = 2`.
  - `noDemand` if `status_sell = 7`; `lowDemand` if `status_sell = 6`.
  - Also carry the raw values for display: `scu_buy` (fallback `scu_buy_avg`), `scu_sell_stock`, and `scu_sell` only when `> 0`. A `status_sell` of 1 is shown only when `scu_sell > 0` (otherwise it is an unreported default, see §4.2).
- **Allowed box sizes** `B = STD ∩ buySizes ∩ sellSizes ∩ shipSizes ∩ [boxRange.min, boxRange.max]` where
  - `STD = {1,2,4,8,16,24,32}`,
  - `buySizes` = the buy row's `container_sizes`; if empty → `{s ∈ STD : s ≤ terminal(stops[i]).maxContainerSize}` (or all STD if that is 0) and flag `boxSizesUnknown`,
  - `sellSizes` = the sell row's `container_sizes`; if empty → `{s ∈ STD : s ≤ terminal(stops[j]).maxContainerSize}` (or all STD if that is 0) and flag `boxSizesUnknown`,
  - `shipSizes` = vehicle sizes; if null → STD and flag `shipBoxSizesUnknown`.
  - If `B` is empty, drop the haul and count it under one reason (counts are per candidate, i.e. per commodity × i × j):
    - `boxTooLarge` — every size offered at the terminals is above `boxRange.max` or not accepted by the ship ("N trades need bigger boxes than your ship takes");
    - `boxTooSmall` — the only sizes offered are below `boxRange.min` ("N trades only come in boxes smaller than your minimum").
- `qtyMax = maxFillable(cap, B)` — the largest integer ≤ `cap` that is a non-negative integer combination of sizes in `B` (unbounded-knapsack reachability DP, O(cap·|B|); cap ≤ ~12,000). If 0 (free SCU smaller than the smallest allowed box), drop it under `boxTooLarge`. `unusedScu = cap − qtyMax` is shown when > 0 (e.g. "2 SCU unused · min box 4").
- Also compute a **box breakdown** for display: greedy largest-first decomposition of the quantity (valid because DP already proved representability; if greedy fails, use the DP backtrack). Include the total box count (e.g. `2×16 + 1×8 + 1×4 = 4 boxes`).

Store per candidate: commodity, i, j, unitBuy, unitSell, margin, qtyMax, B, statuses and reported SCU values (display only), price ages (both rows), flags (`illegal`, `volatileTime`, `temporary`, `noStock`, `lowStock`, `noDemand`, `lowDemand`, `boxSizesUnknown`, `shipBoxSizesUnknown`, `stale` if either row older than 7 days).

### 6.4 Metrics (per haul, for a chosen quantity q)

- `investment = unitBuy × q`
- `revenue = unitSell × q`
- `profit = revenue − investment`
- `roi = profit / investment` (display as %, 1 decimal)
- `profitPerScu = margin`
- `skips = j − i − 1` (number of stops passed without selling)

### 6.5 Result: buy options per stop ("multiple options")

The calculator returns **one list of buy options per stop**: for each stop index `i` from 0 to n−2, every candidate with that buy stop `i`, at `q = qtyMax`.

- **One line per (commodity, sell stop).** A commodity that can be sold at two later stops appears twice, once per sell stop. Skip options (A→C next to A→B) appear naturally.
- **Sorting:** by profit, highest first (default). The user can switch the sort for all stops at once to ROI, margin/SCU or investment, all descending. Tie-break by margin, then commodity name.
- **Inventory warnings never remove or demote a line**; they only add badges.
- **No plans.** The app does not combine hauls into route plans or track cargo on board. The player builds split loads themselves from the per-stop lists, e.g. part of the space for the best commodity (limited stock) plus another commodity from the same stop. This is why each line shows profit for the full free space **and** margin/SCU.
- The last stop has no buy options (it is sell-only).
- Remove the previous plan code (`plans.ts`, `timeline.ts`, `PlanView`) and its tests instead of leaving it unused.

Run the calculation in `useMemo`. Expected input is ≤ 10 stops × ~60 commodities, so a Web Worker is not needed.

**Same terminal twice**: stops are positions, so a terminal visited twice is treated as two independent stops.

### 6.6 Skip hauls vs. trading via the skipped stops

Every skip haul i→j (`skips > 0`) is compared with the **best chain of hauls from i to j that sells at least once at a skipped stop** (`src/calc/stopovers.ts`, after candidate generation):

- Each leg of a chain is one candidate haul at its own `qtyMax` (full free space), any commodity; a leg may itself skip stops. A segment without a profitable haul carries nothing (profit 0).
- Interval DP over stop pairs (n ≤ 10, negligible cost):
  - `best(a, b)` = max of the most profitable direct haul a→b, `via(a, b)`, and 0;
  - `via(a, b)` = max over `a < k < b` of `best(a, k) + best(k, b)`.
- The haul gets `stopovers = { profit: via(i, j), legs, delta: haul.profit − via(i, j) }`, where `legs` lists the chain's hauls in route order (commodity name, from, to, profit) and leaves out empty segments. Hauls without skips have `stopovers = null`.
- Like everything else, the comparison ignores reported inventory and assumes the full hold on every leg.

Example: A→C Laranite 10,000 vs. A→B Agricium 4,000 + B→C Waste 5,000 → `delta = +1,000` (skipping pays more).

---

## 7. User interface

### 7.1 Visual design — "night cockpit"

Dark UI modeled on a Boeing 747 flight deck at night: near-black panels lit by **warm white, slightly amber** light (incandescent panel lighting), not saturated orange. Very sparing use of red-orange for warnings. No pure white anywhere. Define as CSS custom properties on `:root`:

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0a0907` | page background |
| `--panel` | `#13110c` | cards/panels |
| `--panel-raised` | `#1c1910` | inputs, selected rows |
| `--line` | `#3d3220` | borders, dividers |
| `--amber` | `#ffcf7a` | primary values, active elements, focus ring (pale amber) |
| `--amber-bright` | `#ffe8c4` | key numbers such as profit (warm white) |
| `--amber-dim` | `#c99a58` | labels, secondary text, **placeholders** (≈ 7:1 on `--panel`, ≈ 6.5:1 on `--panel-raised`) |
| `--amber-faint` | `#5e4a2c` | **disabled controls only** (fails AA for text, so never use it for readable text or placeholders) |
| `--warn` | `#ff7a4d` | ILLEGAL badge, inventory warnings, errors, stale data |
| `--ok` | `#d9cf8f` | positive/OK status (stays within the warm-white family) |
| `--sel` | `#b5e08f` | "bought" selection: border, ✓, commodity name, sell-reminder border (light green with the same lightness as `--amber`) |
| `--sel-bg` | `rgba(181,224,143,0.12)` | background of bought lines |

These values are a starting point. Tune them in the browser to match the warm-white look, keeping the contrast ratios above.

- Typography: monospace (`Share Tech Mono` or similar) for all numbers, labels in uppercase with `letter-spacing: 0.08em`; tabular numerals (`font-variant-numeric: tabular-nums`). Base size 16 px (prevents iOS zoom on input focus).
- Subtle glow on primary numerals: `text-shadow: 0 0 6px rgba(255,207,122,.30)`; no animations beyond 150 ms transitions; respect `prefers-reduced-motion`.
- `color-scheme: dark`; `<meta name="theme-color" content="#0a0907">`.
- Contrast: all text ≥ WCAG AA against its background (amber-dim on panel must be checked; adjust if below 4.5:1 for body text).

### 7.2 Layout

- Mobile-first, designed for **360–820 px** width (phones and small tablets, portrait and landscape). At ≥ 900 px the content is centered with max-width 820 px (desktop works but is not optimized).
- No horizontal page scroll at 360 px. Tables become stacked cards below 600 px.
- Touch targets ≥ 44×44 px for interactive elements; primary actions reachable by thumb (bottom area). Purely informational elements (badges) are not touch targets and stay small (§7.5).
- Sticky bottom elements (tab bar, CALCULATE TRADES button) are laid out inside the same centered content column as the page (max-width 820 px), so they stay centered at every viewport width. Never position them relative to the viewport's left edge.
- Three views switched by a **bottom tab bar**: `SHIP` · `ROUTE` · `TRADES`. The selected tab and all inputs persist across reloads (Zustand `persist`, key `shc:v1`).
- Header strip: app name "HAULING COMPANION", data status pill (e.g. `PRICES 12m · LIVE 4.10.2`), refresh icon button, **full screen button**.
- **Full screen button** (rightmost in the header, after refresh):
  - **Look:** an icon button with the same style and ≥ 44 px hit area as the refresh button. It uses inline SVG icons: "expand" (four outward corners) when windowed, "collapse" (four inward corners) when in full screen.
  - **Labels:** `aria-label` "Enter full screen" / "Exit full screen" and `aria-pressed`, plus a matching `title` tooltip.
  - **Behaviour:** it toggles the Fullscreen API on `document.documentElement` — `requestFullscreen({ navigationUI: "hide" })` / `document.exitFullscreen()`. Fall back to the `webkit`-prefixed methods (older iPadOS Safari).
  - **State:** the icon follows `fullscreenchange` / `webkitfullscreenchange`, because the user can also leave full screen with Esc or a system gesture. The state is not persisted, since browsers only allow entering full screen from a user gesture.
  - **Unsupported browsers:** when neither `document.fullscreenEnabled` nor `document.webkitFullscreenEnabled` is true (notably iPhone Safari), the button is **not rendered**. Feature-detect it; never sniff the user agent.
  - **Failures:** a rejected request (e.g. a permissions policy in an embedding iframe) is caught silently. The button stays in its windowed state and nothing breaks.
  - **Layout:** in full screen the layout is unchanged. Sticky bottom elements keep `env(safe-area-inset-bottom)` padding.
- Footer (in SHIP view): "Data: UEX Corp (uexcorp.space) · community-sourced, may be inaccurate · Not affiliated with Cloud Imperium Games."

### 7.3 SHIP view

- **Ship** combobox: searches `name_full` (same matching rules as §7.4). Shows vehicles with `scu > 0`; toggle "Show concept ships" (default off). Option line: `Drake Cutlass Black` / secondary `46 SCU · boxes ≤16`.
- **Free cargo (SCU)** numeric input with − / + steppers (step 1, long-press accelerates) and quick buttons `25 %`, `50 %`, `75 %`, `100 %` of ship SCU. Defaults to ship SCU when a ship is chosen, and to 32 SCU when none is. Clamp to 1…ship SCU (if no ship chosen: 1…100,000; the TRADES summary then says "no ship selected").
- **Box sizes** = a **dual-handle range slider** over the discrete steps `1 2 4 8 16 24 32` (evenly spaced, snapping to steps, tick labels under each step). The value is `boxRange = {min, max}`:
  - The range shows as text next to the label, e.g. `BOXES 4–16 SCU`.
  - When a ship is chosen, `max` is preset to the ship's largest accepted size and `min` to `min(4, max)`. The user can change both, and the choice persists.
  - Steps the ship does not accept are drawn disabled on the track. `max` cannot go above the ship's largest size unless the ship's sizes are unknown.
  - If the ship's sizes are unknown, show "Box sizes for this ship unknown — set the largest box that fits" and preset `{min: 4, max: 32}`.
  - Both handles must be usable by touch and keyboard (each handle is a `role="slider"` with arrow keys; ≥ 44 px hit area). Two overlaid native `<input type="range">` elements are acceptable.
- **Filters**: toggles for Include illegal (on) and Include quantum-volatile (off). There are deliberately **no** stock/demand filters; reported inventory only produces warnings.
- Data controls: "Refresh prices", "Reload all data" (with timestamps).

### 7.4 ROUTE view

- Ordered list of stops (2–10). Each row: position number, terminal display, drag handle (pointer + touch reorder; MUST also provide up/down buttons for accessibility), remove button. Rows SHOULD stay compact (about 64–72 px): place the row controls side by side, not stacked.
- **Terminal display** (same format in the route rows, the autocomplete results and the TRADES view):
  - Primary line: `displayname`.
  - Secondary line: the parts below joined with ` · `, skipping null/empty parts and any part that equals, or is contained in, the primary line or an earlier part (case-insensitive, after the normalization in the autocomplete rules):
    1. `name`, only when it differs from `displayname`. This keeps the Area18 terminals apart, e.g. `TDD - Trade and Development Division - Area 18`.
    2. `planet_name`
    3. `moon_name`
    4. `star_system_name`
  - Examples (real data, 2026-10-27):

    | Primary (`displayname`) | Secondary |
    |---|---|
    | `HDMS-Hahn` | `Hurston · Magda · Stanton` (previously the useless `HDMS-Hahn · Stanton`) |
    | `Shubin Mining Facility SM0-22` | `MicroTech · Stanton` |
    | `ARC-L1 Wide Forest Station` | `Admin - ARC-L1 · ArcCorp · Stanton` (and `Platinum Bay - ARC-L1 · ArcCorp · Stanton`) |
    | `Area18` | `TDD - Trade and Development Division - Area 18 · ArcCorp · Stanton` |
  - Cover this with unit tests using these fixture terminals.
- "Add stop" field at the bottom = **autocomplete**:
  - Source: terminals from E2 with `is_available_live && is_visible` (toggle "show unavailable terminals").
  - Haystack per terminal: `name, nickname, displayname, fullname, code, space_station_name, city_name, outpost_name, moon_name, planet_name, orbit_name, star_system_name`, lower-cased and diacritics-stripped (`normalize('NFD').replace(/\p{Diacritic}/gu,'')`), with `-`, `_`, `.` and `'` treated as spaces so `"arc l1"`, `"arcl1"` and `"ARC-L1"` all match.
  - Matching: split query into tokens; a terminal matches if **every** token is a substring of the haystack (also try the haystack with spaces removed so `"area18"` matches `"Area 18"`).
  - Ranking: exact `code`/`nickname` match > `displayname`/`nickname` prefix > word-start match > substring; tie-break alphabetical by `displayname`. Show max 12 results.
  - Results show as an overlay list above the on-screen keyboard; keyboard support (↑ ↓ Enter Esc) on desktop. Selecting adds the stop and clears the input (focus stays to add the next).
  - Start filtering at 1 character; no network calls (all local).
- "Clear route" with confirmation; "Reverse route" button.
- A sticky bottom button "CALCULATE TRADES →" switches to TRADES (calculation is also live/automatic whenever inputs change). It is horizontally centered in the content column at every width (§7.2): full column width below 600 px, otherwise max-width 480 px with `margin-inline: auto`.

### 7.5 TRADES view

- Summary header: route (`ARC-L1 → Area18 TDD → …`), free SCU, ship, box range, data age.
- Sort selector for all stop lists: Profit (default), ROI, Margin/SCU, Investment — all descending.
- Empty/insufficient states:
  - fewer than 2 stops → hint linking to ROUTE;
  - no profitable trades → "No profitable trades along this route" + count of dropped trades by reason (`boxTooLarge`, `boxTooSmall`, illegal filter, volatile filter, price-age filter).
- **Stop sections**, one per stop in route order:
  - Header: stop number + terminal display (§7.4).
  - Body: the buy options for that stop (§6.5) as a compact list. Show the top 5; a "Show N more" button expands the rest.
  - A stop with no options says "Nothing profitable to buy here". The last stop says "Final stop — sell only".
- **Option line** (collapsed, up to three text rows). **At the current stop, tapping the line toggles it as bought** (§7.6). It is a toggle button (`aria-pressed`), ≥ 44 px tall. Details have their **own, clearly labelled button** (see Details button). Contents:
  - Row 1: commodity name, followed directly by its **allowed box sizes** (e.g. `Laranite □ 4·8·16`). The **Details button** is right-aligned on the same row.
  - Row 2: `→ #3 TDD Area 18` — sell stop number + short terminal name (`nickname`, falling back to `displayname`), followed by **all badges** (`SKIPS 1`, `ILLEGAL`, warnings …).
  - **Buy and sell price per SCU**, always visible without expanding: `BUY 2,810 → SELL 3,315 /SCU`. Labels in `--amber-dim`, values in `--amber`, tabular numerals.
  - **Profit** for the full load (`--amber-bright`, right-aligned) and ROI %.
  - **Skip lines only** — a fourth row, full width, 13 px mono, compares the line with trading via the skipped stops (§6.6): `▲ 1,000 more than via #2` in `--amber`, `▼ 460 less than via #2–#3` in `--warn`, or `= same as via #2`. Skipped stops are 1-based, a range when several.
  - Example layout at 360 px (illustrative values):

    ```
    Laranite □ 4·8·16                  [ DETAILS ⌄ ]
    → #3 TDD Area 18 [SKIPS 1] [ILLEGAL] +22,220 aUEC
    BUY 2,810 → SELL 3,315 /SCU             18.0 %
    ▲ 1,000 more than via #2
    ```
- **Details button** — it must clearly look like a button, unlike the bare `v` of revision 4:
  - **Label:** text `DETAILS` plus a chevron; when open, `HIDE` plus the chevron rotated 180°. Uppercase mono, 12 px, `--amber`.
  - **Chevron:** do not use text glyphs (`⌄`, `^`, `v`). Their font metrics put them on or above the baseline, so they never center. Use the same inline SVG chevron as the dropdowns: 12 × 12 px, `stroke: currentColor`, `display: block`. Lay out the label and icon with `display: inline-flex; align-items: center; gap: 6px`, so the icon's optical center lines up with the text's x-height center in both states.
  - **Style:** 1 px `--amber-dim` border, 4 px radius, `--panel-raised` background, padding 4 × 10 px, visual height ≈ 28 px. Hover/focus: border `--amber`. Pressed/open: border `--amber` and background slightly lighter.
  - **Size:** the hit area is ≥ 44 × 44 px, extended with transparent padding or a pseudo-element.
  - **Layout:** it sits in normal document flow at the right end of row 1 and is never absolutely positioned, so it can't overlap the profit. Below 360 px content width the label may shorten to `⌄` / `⌃`, but the bordered box stays.
  - **Behaviour:** `aria-expanded` + `aria-controls`. Its tap (`stopPropagation`) **only** opens or closes details and never changes "bought".
  - Shown on every line at every stop, including departed stops viewed read-only.
- **Expanded line** — details shown below the three rows while the line's Details button is open:
  - Open/closed is **independent** of "bought": marking or unmarking a line does not open or close details, and an open line can be closed without unmarking it.
  - The state is per line, held in UI state only (not persisted); all lines start closed.
  - On lines that are not toggles (later stops, departed stops viewed read-only), tapping the line body also opens or closes details.
  
  Content:
  - Margin/SCU (buy and sell price are already on the collapsed line).
  - Quantity (`44 of 46 SCU`, plus "2 SCU unused · min box 4" when applicable) and the box breakdown with count.
  - Investment, revenue, profit, ROI.
  - Price ages for both rows.
  - Skip lines: "Trading via #2 instead" with one row per chain leg (`#1 → #2 Agricium 4,000`) or "No profitable trade sells at #2.", then the fields Via stops, Skipping (the line's profit) and Difference (signed).
  - Reported inventory with its explanation, e.g. "Reported 9 h ago: stock Out of Stock (0–14 %), 0 SCU. Inventory may have refilled since." This replaces the tappable badges.
- **Badges** are small, non-interactive chips: height ≈ 18–20 px, font 11 px uppercase, padding 0 6 px, 1 px outline. They are **not** touch targets.
  - Types: `ILLEGAL` (`--warn` fill), `SKIPS n` (amber outline), `STALE 9d`, `VOLATILE`.
  - Inventory warnings (`--warn` outline, question mark because the data is reported, not live): `NO STOCK?`, `LOW STOCK?`, `NO DEMAND?`, `LOW DEMAND?`.
  - Badges sit on row 2 after the sell stop. On narrow lines, show at most 3 badges and a `+n` chip; the expanded line lists all of them.
- Number format: `en-US` grouping (`1,234,567`) with unit `aUEC`; on narrow cards MAY use compact (`1.23M`) with full value in `title`/expand. Percentages 1 decimal.
- All results recompute synchronously (memoized) on any input change; no "calculate" round-trip to the API.

### 7.6 Trip mode (TRADES view while flying the route)

The TRADES view doubles as an in-flight checklist: the player marks what they bought, departs each stop, and sees where to sell.

**State** (persisted with the rest of the app state, so a reload mid-flight keeps progress):

```ts
interface TripState {
  currentStop: number;              // index of the first stop not yet departed (0 at start)
  bought: BoughtLine[];             // lines marked as bought, in the order they were marked
}
interface BoughtLine {
  key: string;                      // `${buyStop}:${commodityId}:${sellStop}`
  buyStop: number; sellStop: number; commodityId: number;
  // snapshot at the moment of marking, so reminders survive price refreshes:
  commodityName: string; unitBuy: number; unitSell: number; boxSizes: number[]; illegal: boolean;
}
```

- A stop `k` is **departed** iff `k < currentStop`.
- Lines are only markable at the **current stop**. Lines at later stops stay visible for planning but are not toggles; tapping them only expands/collapses their details.
- Trip state resets to `{currentStop: 0, bought: []}` whenever the route's stop list changes (add, remove, reorder, reverse, clear). The ROUTE view warns with an inline note while a trip is in progress: "Editing the route resets trip progress (at stop 3 of 7)".

**Marking a line as bought** (tap on an option line at the current stop):

- It toggles the line's membership in `bought` and takes the snapshot.
- Several lines can be marked: split loads, several commodities, or the same commodity to two sell stops.
- Bought lines get a light-green highlight that matches the amber's lightness, and **also** a ✓ check mark at the start of the first row, so the state is not shown by colour alone.
  - New tokens in §7.1: `--sel` `#b5e08f` (relative luminance ≈ 0.65, like `--amber` ≈ 0.67) for the line border (thickened to 2 px), the ✓ and the commodity name; `--sel-bg` `rgba(181,224,143,0.12)` for the line background.
  - Text colours inside the line stay as they are.
- Bought lines stay in their ranked position and are always shown, even if they fall outside the top 5 ("Show N more").
- If a price refresh makes a bought line disappear from the results, keep showing it from its snapshot at its old position, with an `UPDATED PRICES` note.

**Depart button** (only on the current stop, never on the last stop):

- Label `DEPART →`. Normal button styling, ≥ 44 px.
- **Position:** at ≥ 600 px it sits at the right end of the stop header (where the red circle is in the product owner's screenshot). Below 600 px it moves under the stop's list (after "Show N more" and the sell reminders), full column width.
- **On tap:**
  1. `currentStop` becomes `k + 1`.
  2. Stop `k` **collapses** to its header with a `DEPARTED` tag and a one-line summary, e.g. `Bought Scrap, Steel · Sold Waste`. Tapping a departed header expands it read-only (no toggles, no Depart button).
  3. Every line bought at `k` appears as a **sell reminder** at its sell stop.
  4. The view scrolls the new current stop's header into view.
- **Undo:** the most recently departed stop's header shows an `UNDO` button for as long as it is the most recent. It moves `currentStop` back by one and keeps its bought lines.

**Sell reminders** (at stop `j`, shown above that stop's buy list, under the heading `SELL HERE`):

- One reminder per bought line with `sellStop = j`.
- Format: `✓ Scrap · bought #2 Everus Harbor @ 2,954 → sell @ 3,600 /SCU`, plus the `ILLEGAL` badge if applicable. Styling: `--sel` left border, no fill.
- Reminders at stops that are not the current stop are shown dimmed (still upcoming).
- Departing stop `j` ends its reminders; they are counted as "Sold" in the departed summary.

**Current stop emphasis:** the current stop's section has a 2 px `--amber` border. The summary header shows `AT STOP k OF n`, plus `ON BOARD:`, which lists bought lines from departed stops that are not yet sold (`Scrap → #3, Steel → #7`).

**Complete route** (after the last stop's section, once `currentStop = n − 1`, i.e. every earlier stop is departed):

- Full-width button `COMPLETE ROUTE ✓`.
- On tap: clear the route's stops, reset trip state, switch to the ROUTE view.
- Ship, free SCU, box range and filters are kept.
- No confirmation dialog, because the user explicitly finishes the route here.

### 7.7 Accessibility and robustness

- Semantic HTML, labelled inputs, combobox ARIA pattern for autocomplete, focus visible (amber ring).
- **Dropdown indicators** (sort `<select>` and any other select/combobox with a chevron): the chevron's right edge sits 14–16 px inside the control's border, with ≥ 8 px gap to the text (`padding-inline-end` ≥ 40 px). It is never flush with the edge. Use one shared style for all of them.
- Works offline after first load (data from cache) — a service worker/PWA is **MAY** (not required).
- Handle API schema surprises defensively: unknown/missing fields must not crash; drop malformed records and `console.warn` once per dataset.

---

## 8. Acceptance criteria (v1.0)

1. `docker compose up dev` serves the app on :5173 with hot reload on a Windows host; `docker compose run --rm test` and `docker compose run --rm lint` (oxlint + TS 7 typecheck) pass; `docker compose up --build app` serves the production build on :8080. No host Node required. `package.json` contains TypeScript 7 and no ESLint packages.
2. First load performs at most 5 API requests (E1–E5); reload within 30 min performs 0; after 30 min opening TRADES performs exactly 1 (E4). Verified via the browser network panel and a unit test with a mocked `fetch`.
3. Typing `arc l1`, `ARCL1`, `wide forest` or `area18` in the stop field shows the corresponding terminals; duplicates of a `displayname` are distinguishable by the secondary line; the secondary line never repeats the primary line (`HDMS-Hahn` shows `Hurston · Magda · Stanton`).
4. Selecting a ship sets free SCU and the box range; changing free SCU or either end of the box range immediately updates all results.
5. Raw commodities (`is_raw = 1`) and items never appear. Illegal commodities are badged and can be hidden.
6. TRADES shows one section per stop; each non-final stop lists its buy options ranked by the selected sort; every line names its sell stop; a commodity sellable at two later stops appears as two lines; skip options carry a `SKIPS n` badge. No plan chips or plan timeline exist.
7. Hauls whose allowed box set is empty are excluded and counted as `boxTooLarge` or `boxTooSmall`.
8. Quantities never exceed free SCU and use only box sizes within the selected range that the buy terminal, sell terminal and ship all accept (unit-tested).
9. Every option line shows the commodity's allowed box sizes next to its name, without expanding.
10. Every collapsed option line shows commodity, allowed box sizes, sell stop, buy price/SCU, sell price/SCU, profit, ROI and legal/illegal; the expanded line adds quantity, box breakdown and price ages.
11. Layout has no horizontal scroll at 360 px width; all interactive touch targets ≥ 44 px; badges ≤ 20 px tall; warm-white amber theme as in §7.1; the CALCULATE TRADES button and tab bar are centered in the content column at 360, 820 and 1440 px width.
12. Unit-test coverage for `src/calc/**` and `src/api/mappers.ts` ≥ 90 % lines.
13. Reported inventory never removes, caps or re-ranks a trade: a haul whose buy row has `status_buy = 1` and `scu_buy = 0` still appears with full `qtyMax` and a `NO STOCK?` badge (unit-tested).
14. Trip mode (§7.6):
    - Tapping a line at the current stop toggles a green highlight plus ✓ and nothing else.
    - Every line has a visibly bordered `DETAILS ⌄` button. It opens and closes details independently of "bought", and never overlaps the profit.
    - Depart sits top-right in the stop header at ≥ 600 px and under the list at < 600 px.
    - Departing collapses the stop and shows each bought line as a sell reminder at its sell stop. Undo restores the previous state.
    - After the last departure, `COMPLETE ROUTE` clears the stops and opens ROUTE.
    - Trip progress survives a page reload and resets when the route is edited.
15. The header's full screen button enters and leaves full screen. Its icon and label follow the real state, including leaving with Esc. It is absent where the Fullscreen API is unavailable. Unit-tested with a mocked Fullscreen API: supported, unsupported, and rejected request.
16. Every skip line shows, without expanding, how much more or less it earns than the best chain of trades via the skipped stops (§6.6); the expanded line lists that chain's legs and the difference. Lines without skips show no comparison.

### 8.1 Required unit tests (minimum)

- `mappers`: numeric strings, `"null"`/`""` CSV handling, 0/1 booleans, ignoring non-standard box sizes.
- `maxFillable`: `(46,{1,2,4,8,16}) = 46`, `(46,{8,16}) = 40`, `(7,{8,16}) = 0`, `(30,{24}) = 24`.
- Candidate generation: excludes raw, non-positive margin, empty box sets; inventory statuses only set warning flags (never exclude or cap).
- Box range: `{min 4, max 16}` with buy sizes `1,2,4,8,16,24,32` → B = {4,8,16}; buy sizes `1,2` with min 4 → dropped as `boxTooSmall`; sell row sizes narrow B; 46 SCU with B = {4,8,16} → 44 SCU, 2 unused.
- Stopover comparison (§6.6): A→C vs. A→B + B→C with different commodities; a longer skip whose best chain contains a skip leg; negative delta; empty chain (profit 0, no legs); hauls without skips stay `null`.
- Per-stop grouping: lines grouped by buy stop, one line per (commodity, sell stop), last stop empty, all four sort orders descending with the specified tie-break.
- Terminal secondary line: the examples table in §7.4.
- Trip state as pure reducer functions (e.g. `src/trip/tripReducer.ts`): toggle bought (only at the current stop), depart, undo, complete, reset on route change, reminders per stop, on-board list, snapshot survival when a line disappears from the results.
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
| ~15 cargo ships (Hull D/E, Kraken, Galaxy, Idris-P …) have no `container_sizes` | Can't infer max box | Box range slider, defaults to 4–32 with notice |
| Ship cargo grids are physical 3D grids; a total SCU can't always be packed with any box mix | Quantities may be slightly optimistic | Out of scope; the box range lets the user be conservative |
| Prices are crowdsourced; median age ~2 days, some > 2 weeks | Profit estimates may be wrong | Always show age; `STALE` badge > 7 days; optional max-age filter |
| `kind` field is inconsistent (`Man-made` vs `Man-Made`, `Minteral`) | None (not used for logic) | Display only |
| Numeric fields sometimes strings | Possible bugs | Mandatory coercion in mappers |
| No travel distance/time in v1 | Can't compute profit/hour | Not required for v1 (route order is fixed by the mission); `terminals_distances` exists if needed later |
| No trade tax/fees modelled | Profit overstated if the game adds fees | None in current game mechanics known to the spec author; out of scope |

### 9.3 Assumptions made (decide-by-default; change if the product owner disagrees)

1. **Stops are terminals**, not locations. A station with several commodity terminals requires picking the terminal. (Alternative: let a stop be a location and merge all its commodity terminals.)
2. **One free-SCU value** for the whole route. Real missions often load/unload mission cargo along the way, which changes free space per segment. A per-segment override would size each haul i→j by the smallest free space over segments i…j−1 instead of C (a small v1.1 addition).
3. **No aUEC budget limit**. Each line shows its investment instead.
4. **Illegal commodities included by default** (badged).
5. **Quantum-volatile commodities excluded by default**, because a hauling route always involves quantum travel.
6. Deployment target is GitHub Pages (static, from `master`); the local `app` container stays for testing the production build.

### 9.4 Verdict

All information required by the stated v1.0 feature set is available from public, key-less UEX endpoints, reachable from the browser, in 5 requests. The remaining uncertainties are data-quality issues (reported inventory, some box-size data), not missing data, and the spec defines a deterministic handling for each. With the assumptions in §9.3 the spec is implementable hands-off.

---

## 10. Future (not v1.0)

- Per-segment free SCU (mission cargo pickup/drop-off).
- Location-level stops (merge terminals at the same station/city).
- Travel distance and profit/hour via `terminals_distances` (cached per pair).
- aUEC budget constraint.
- Split-load helper: tap a line to enter the SCU actually bought (e.g. stock limit at the terminal), and the stop's other lines recompute profit for the remaining space.
- Cargo-on-board tracking / route plans (removed in revision 2 in favour of per-stop lists). Brought back with user-entered stock limits, plan optimization would need a min-cost-flow formulation.
- PWA install + offline shell.
- Share route via URL (encode terminal ids).
