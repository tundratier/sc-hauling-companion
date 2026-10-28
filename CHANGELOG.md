# Changelog

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

