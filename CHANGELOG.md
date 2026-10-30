# Changelog

## 1.2.1 - 2026-10-30

### Bug Fixes

- **route:** Space the stop row buttons
- **route:** Open the stop search list on the side with room

## 1.2.0 - 2026-10-29

### Features

- **calc:** Compute the best haul profit for every ordered terminal pair
- **route:** Search the best profitable stops to insert between the fixed stops
- **api:** Load the terminal map lazily and cache it per game version
- **route:** Persist the add-profitable-stops options and accept suggested stops
- **route:** Run the stop search in a Web Worker with a latest-request-only client
- **route:** Suggest profitable stops in the route list with Add, Add all and dismiss
- **trades:** Collapse worse skip lines into one compact dimmed row

### Bug Fixes

- **route:** Keep accepted dynamic stops counting towards the suggestion limits

### Build and CI

- **terminal-map:** Add dry-run compiler and compose service
- **terminal-map:** Plan the routing set and ignore stations without an orbit
- **terminal-map:** Add the fixed distance probe and its raw responses
- **terminal-map:** Compile the map with MDS from the committed raw data
- **terminal-map:** Add the orbits_distances fetch step for new game versions
- **terminal-map:** Serve the map from public/ with a travel table (schema 2)
- Ignore Claude worktrees in vitest, oxlint and prettier

### Miscellaneous

- **terminal-map:** Add the compiled 4.10.2 map data and its loader

## 1.1.0 - 2026-10-29

### Features

- **calc:** Compare skip hauls with trading via the skipped stops
- **results:** Show how skip lines compare with trading via the skipped stops

### Bug Fixes

- **results:** Name the comparison chain's stops in the skip verdict

## 1.0.1 - 2026-10-28

### Build and CI

- **docker:** Add check and dist stages and a configurable base path
- Deploy to GitHub Pages on pushes to master
- List build, ci and chore commits in the changelog

### Miscellaneous

- Add MIT license

## 1.0.0 - 2026-10-28

### Features

- **api:** Map UEX responses to domain types
- **api:** Add UEX client with envelope check, typed errors and 15 s timeout
- **cache:** Add IndexedDB TTL cache with in-memory fallback
- **cache:** Load static data and prices with stale-while-revalidate
- **calc:** Compute fillable quantities and box breakdowns
- **calc:** Generate candidate hauls with box and inventory handling
- **calc:** Build the top plans by DP over stops with execution timeline
- **theme:** Add night cockpit tokens, base styles and bundled fonts
- **ui:** Add app shell with header strip and bottom tab bar
- **route:** Add local terminal and ship autocomplete matching
- **ui:** Add persisted app state and data store with startup/offline handling
- **ship:** Add ship search, free cargo stepper, max box and filters
- **route:** Add route builder with autocomplete, reorder and clear
- **ui:** Show data status pill, offline banner and prices refresh in header
- **results:** Add inventory status labels and reported-value explanations
- **results:** Show plan KPIs and a stop-by-stop execution timeline
- **results:** List plans and single hauls with sorting and paging
- **calc:** Constrain boxes by a min-max range and the sell row sizes
- **ship:** Replace the max box size control with a box range slider
- **calc:** Group buy options per stop instead of building plans
- **results:** Show buy options under each stop with the sell stop and box sizes
- **theme:** Shift the amber palette towards warm white
- **results:** Show buy and sell price per SCU on the collapsed option line
- **trip:** Add a pure trip-mode reducer
- **trip:** Persist trip progress and reset it when the route changes
- **theme:** Add light green selection tokens for bought lines
- **route:** Warn that editing the route resets trip progress
- **results:** Mark lines as bought, depart stops and show sell reminders
- **ui:** Add a full screen button to the header

### Bug Fixes

- **ui:** Keep status pill casing and make warning badges 44 px tall
- **ship:** Default free cargo to 32 SCU when no ship is selected
- **ui:** Center the sticky button and tab bar in the content column
- **route:** Show planet and moon instead of repeating the terminal name
- **results:** Remove the line details chevron and show details on bought lines
- **ui:** Give dropdown chevrons proper inner spacing
- **results:** Restore the details button as a labelled button independent of bought
- **results:** Center the details button chevron with an inline svg

### Build and CI

- **docker:** Add multi-stage Dockerfile, compose services and nginx config
- Add eslint and prettier configuration
- Add git-cliff configuration for version derivation
- Avoid escape sequences in cliff tag pattern
- Switch to TypeScript 7 and oxlint, remove ESLint

### Miscellaneous

- Scaffold Vite React TypeScript app with Vitest


