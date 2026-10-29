import { useCallback, useMemo, useRef, useState, type PointerEvent } from 'react'
import { Combobox } from '../components/Combobox'
import { DataGate } from '../components/DataGate'
import { SuggestPanel, suggestionSummary } from '../components/SuggestPanel'
import { SuggestedRow } from '../components/SuggestedRow'
import { searchTerminals } from '../domain/search'
import { terminalDisplay } from '../domain/terminalDisplay'
import type { Terminal } from '../domain/types'
import { useSuggestions } from '../hooks/useSuggestions'
import { indexAtY } from '../lib/drag'
import { MAX_STOPS, MIN_STOPS, useAppStore } from '../state/useAppStore'
import { useDataStore } from '../state/useDataStore'
import { useSuggestUi } from '../state/useSuggestUi'
import { inProgress } from '../trip/tripReducer'

interface StopRowProps {
  index: number
  count: number
  terminal: Terminal | undefined
  terminalId: number
  dragging: boolean
  over: boolean
  onUp: () => void
  onDown: () => void
  onRemove: () => void
  onDragStart: (e: PointerEvent<HTMLButtonElement>) => void
  onDragMove: (e: PointerEvent<HTMLButtonElement>) => void
  onDragEnd: (e: PointerEvent<HTMLButtonElement>) => void
}

function StopRow(p: StopRowProps) {
  const display = p.terminal ? terminalDisplay(p.terminal) : undefined
  const name = display?.primary ?? `Unknown terminal (#${p.terminalId})`
  return (
    <li
      data-stop-row
      className={`stop${p.dragging ? ' stop--dragging' : ''}${p.over ? ' stop--over' : ''}`}
    >
      <span className="stop__index num">{p.index + 1}</span>
      <div className="stop__text">
        <div className="stop__primary">{name}</div>
        {display?.secondary && <div className="stop__secondary">{display.secondary}</div>}
      </div>
      <div className="stop__actions">
        <button
          type="button"
          className="stop__handle"
          aria-label={`Drag stop ${p.index + 1} to reorder`}
          onPointerDown={p.onDragStart}
          onPointerMove={p.onDragMove}
          onPointerUp={p.onDragEnd}
          onPointerCancel={p.onDragEnd}
        >
          ⠿
        </button>
        <button
          type="button"
          className="btn"
          aria-label={`Move stop ${p.index + 1} up`}
          disabled={p.index === 0}
          onClick={p.onUp}
        >
          ↑
        </button>
        <button
          type="button"
          className="btn"
          aria-label={`Move stop ${p.index + 1} down`}
          disabled={p.index === p.count - 1}
          onClick={p.onDown}
        >
          ↓
        </button>
        <button
          type="button"
          className="btn btn--danger"
          aria-label={`Remove stop ${p.index + 1}`}
          onClick={p.onRemove}
        >
          ✕
        </button>
      </div>
    </li>
  )
}

function RouteEditor() {
  const terminals = useDataStore((s) => s.staticData!.data.terminals)
  const app = useAppStore()
  const { stops } = app
  const trip = useAppStore((s) => s.trip)
  const suggestion = useSuggestions()
  const dismiss = useSuggestUi((s) => s.dismiss)
  const suggested = suggestion.status === 'ready' ? suggestion.result : null
  const [confirmClear, setConfirmClear] = useState(false)
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null)
  const listRef = useRef<HTMLOListElement>(null)

  const byId = useMemo(() => new Map(terminals.map((t) => [t.id, t])), [terminals])
  const available = useMemo(
    () =>
      app.showUnavailableTerminals
        ? terminals
        : terminals.filter((t) => t.isAvailableLive && t.isVisible),
    [terminals, app.showUnavailableTerminals],
  )
  const search = useCallback((query: string) => searchTerminals(available, query), [available])
  const full = stops.length >= MAX_STOPS

  const rowAt = (y: number) =>
    indexAtY(
      [...(listRef.current?.querySelectorAll('[data-stop-row]') ?? [])].map((el) =>
        el.getBoundingClientRect(),
      ),
      y,
    )
  const dragStart = (index: number, e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    setDrag({ from: index, over: index })
  }
  const dragMove = (e: PointerEvent<HTMLButtonElement>) => {
    if (!drag) return
    const over = rowAt(e.clientY)
    if (over !== drag.over) setDrag({ ...drag, over })
  }
  const dragEnd = () => {
    if (drag && drag.over !== drag.from) app.moveStop(drag.from, drag.over)
    setDrag(null)
  }

  return (
    <div className="stack">
      {inProgress(trip) && (
        <p className="banner" role="note">
          Editing the route resets trip progress (at stop{' '}
          {Math.min(trip.currentStop + 1, Math.max(1, stops.length))} of {stops.length})
        </p>
      )}
      {suggested && (
        <div className="panel stack suggest__summary" aria-label="Suggestion summary">
          <p className="num">{suggestionSummary(suggested)}</p>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => app.replaceStops(suggested.route)}
          >
            Add all
          </button>
        </div>
      )}
      {stops.length === 0 ? (
        <p className="panel muted">
          No stops yet. Add the terminals you must visit, in order — at least {MIN_STOPS}.
        </p>
      ) : (
        <ol ref={listRef} className="stops" aria-label="Route stops">
          {stops.flatMap((id, i) => [
            <StopRow
              key={`${i}-${id}`}
              index={i}
              count={stops.length}
              terminal={byId.get(id)}
              terminalId={id}
              dragging={drag?.from === i}
              over={!!drag && drag.over === i && drag.from !== i}
              onUp={() => app.moveStop(i, i - 1)}
              onDown={() => app.moveStop(i, i + 1)}
              onRemove={() => app.removeStop(i)}
              onDragStart={(e) => dragStart(i, e)}
              onDragMove={dragMove}
              onDragEnd={dragEnd}
            />,
            ...(suggested?.stops ?? [])
              .filter((s) => s.gapIndex === i)
              .sort((a, b) => a.position - b.position)
              .map((s) => (
                <SuggestedRow
                  key={`suggested-${s.terminalId}`}
                  stop={s}
                  result={suggested!}
                  byId={byId}
                  onAdd={() => app.insertStop(i + 1, s.terminalId)}
                  onDismiss={() => dismiss(s.terminalId)}
                />
              )),
          ])}
        </ol>
      )}
      <p className="muted num" aria-live="polite">
        {stops.length} / {MAX_STOPS} stops
      </p>

      <SuggestPanel state={suggestion} stopCount={stops.length} />

      <section className="panel stack" aria-label="Add stop">
        {full ? (
          <p className="warn">Maximum of {MAX_STOPS} stops reached.</p>
        ) : (
          <Combobox
            label="Add stop"
            placeholder="Terminal, station or city, e.g. arc l1"
            search={search}
            getKey={(t) => t.id}
            renderOption={(t) => {
              const { primary, secondary } = terminalDisplay(t)
              return { primary, secondary }
            }}
            onSelect={(t) => app.addStop(t.id)}
            clearOnSelect
            placement="up"
            emptyText="No terminal matches"
          />
        )}
        <label className="toggle">
          <input
            type="checkbox"
            checked={app.showUnavailableTerminals}
            onChange={(e) => app.setShowUnavailableTerminals(e.target.checked)}
          />
          <span>Show unavailable terminals</span>
        </label>
      </section>

      <div className="row row--wrap">
        <button
          type="button"
          className="btn grow"
          disabled={stops.length < 2}
          onClick={app.reverseStops}
        >
          Reverse route
        </button>
        {confirmClear ? (
          <>
            <button
              type="button"
              className="btn btn--danger grow"
              onClick={() => {
                app.clearStops()
                setConfirmClear(false)
              }}
            >
              Confirm clear
            </button>
            <button type="button" className="btn grow" onClick={() => setConfirmClear(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn grow"
            disabled={stops.length === 0}
            onClick={() => setConfirmClear(true)}
          >
            Clear route
          </button>
        )}
      </div>
    </div>
  )
}

export function RouteView() {
  const setTab = useAppStore((s) => s.setTab)
  return (
    <section className="view" aria-labelledby="route-title">
      <h2 id="route-title" className="view-title">
        Route
      </h2>
      <DataGate>
        <RouteEditor />
      </DataGate>
      <div className="sticky-action">
        <button
          type="button"
          className="btn btn--primary btn--block"
          onClick={() => setTab('trades')}
        >
          Calculate trades →
        </button>
      </div>
    </section>
  )
}
