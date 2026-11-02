import { useEffect, useId, useRef, useState } from 'react'
import type { Haul } from '../calc'
import { terminalDisplay } from '../domain/terminalDisplay'
import type { Terminal } from '../domain/types'
import { formatInt, formatSigned } from '../lib/format'
import { shortName } from '../lib/terminalNames'
import {
  boughtAt,
  boughtKey,
  isMoved,
  remindersAt,
  snapshotOf,
  stopItems,
  summaryText,
  unitSellOf,
  type BoughtLine,
  type TripState,
} from '../trip/tripReducer'
import type { SellOption } from '../trip/sellElsewhere'
import { OptionLine } from './OptionLine'

export const TOP_N = 5

interface StopSectionProps {
  index: number
  stopCount: number
  terminalId: number
  options: Haul[]
  terminalById: Map<number, Terminal>
  stops: number[]
  freeScu: number
  minBox: number
  now: number
  trip: TripState
  onToggle: (line: BoughtLine) => void
  onDepart: () => void
  onUndo: () => void
  /** Other stops a waiting reminder can move to ("Can't sell all?"). */
  sellOptionsFor: (line: BoughtLine) => SellOption[]
  onMoveReminder: (key: string, stop: number, unitSell: number) => void
}

/** A bought line whose haul disappeared from refreshed results, shown from its snapshot. */
function SnapshotLine({
  line,
  terminalById,
  stops,
  onToggle,
}: {
  line: BoughtLine
  terminalById: Map<number, Terminal>
  stops: number[]
  onToggle?: () => void
}) {
  const sellName = shortName(terminalById.get(stops[line.sellStop]), stops[line.sellStop])
  const body = (
    <>
      <span className="option__name">
        <span className="option__check" aria-hidden="true">
          ✓{' '}
        </span>
        <strong>{line.commodityName}</strong>{' '}
        <span className="num muted option__boxes">□ {line.boxSizes.join('·')}</span>
      </span>
      <span className="option__sell">
        <span>
          → <span className="num">#{line.sellStop + 1}</span> {sellName}
        </span>
        <span className="badge badge--warn">UPDATED PRICES</span>
      </span>
      <span className="option__prices num">
        <span className="option__price">
          <span className="option__label">BUY</span> {formatInt(line.unitBuy)}
        </span>{' '}
        <span className="option__label">→</span>{' '}
        <span className="option__price">
          <span className="option__label">SELL</span> {formatInt(line.unitSell)}{' '}
          <span className="option__label">/SCU</span>
        </span>
      </span>
    </>
  )
  return (
    <li className="option option--bought option--snapshot">
      <div className="option__row">
        {onToggle ? (
          <button type="button" className="option__line" aria-pressed onClick={onToggle}>
            {body}
          </button>
        ) : (
          <div className="option__line option__line--static">{body}</div>
        )}
      </div>
    </li>
  )
}

/** One sell reminder with its muted "Can't sell all?" action (SPEC §7.6). */
function SellReminder({
  line,
  terminalById,
  stops,
  options,
  onMove,
}: {
  line: BoughtLine
  terminalById: Map<number, Terminal>
  stops: number[]
  options: SellOption[]
  onMove: (stop: number, unitSell: number) => void
}) {
  const [open, setOpen] = useState(false)
  const listId = useId()
  const moved = isMoved(line)
  const name = (stop: number) => shortName(terminalById.get(stops[stop]), stops[stop])
  return (
    <li className="reminder">
      <div>
        <span aria-hidden="true">✓ </span>
        <strong>{line.commodityName}</strong> · bought{' '}
        <span className="num">#{line.buyStop + 1}</span> {name(line.buyStop)} @{' '}
        <span className="num">{formatInt(line.unitBuy)}</span> → sell @{' '}
        <span className="num reminder__sell">{formatInt(unitSellOf(line))}</span> /SCU
        {moved && (
          <span className="reminder__moved">
            {' '}
            · moved from <span className="num">#{line.sellStop + 1}</span>
          </span>
        )}
        {line.illegal && <span className="badge badge--illegal">ILLEGAL</span>}
      </div>
      <button
        type="button"
        className="reminder__more"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen(!open)}
      >
        <span>Can't sell all?</span>
        <svg
          className="reminder__chevron"
          width="10"
          height="10"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M2 4.25 6 8.25 10 4.25" />
        </svg>
      </button>
      {open && (
        <div id={listId} className="reminder__options">
          {options.length === 0 ? (
            <p className="muted">No other stop on this route buys {line.commodityName}.</p>
          ) : (
            <ul className="reminder__choices">
              {options.map((o) => (
                <li key={o.stop}>
                  <button
                    type="button"
                    className="btn reminder__choice"
                    onClick={() => {
                      onMove(o.stop, o.unitSell)
                      setOpen(false)
                    }}
                  >
                    <span className="num">#{o.stop + 1}</span> {name(o.stop)} · sell{' '}
                    <span className="num">{formatInt(o.unitSell)}</span> /SCU{' '}
                    <span className="num reminder__delta">
                      ({formatSigned(o.deltaVsBuy)} vs. buy)
                    </span>
                    {o.original && <span className="muted"> · original stop</span>}
                    {o.demand && (
                      <span className="badge badge--warn">
                        {o.demand === 'noDemand' ? 'NO DEMAND?' : 'LOW DEMAND?'}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  )
}

/** SELL HERE: bought lines from departed stops whose effective sell stop is this stop. */
function SellReminders({
  lines,
  upcoming,
  terminalById,
  stops,
  optionsFor,
  onMove,
}: {
  lines: BoughtLine[]
  upcoming: boolean
  terminalById: Map<number, Terminal>
  stops: number[]
  optionsFor: (line: BoughtLine) => SellOption[]
  onMove: (key: string, stop: number, unitSell: number) => void
}) {
  if (lines.length === 0) return null
  return (
    <div className={`reminders${upcoming ? ' reminders--upcoming' : ''}`}>
      <h4 className="label reminders__title">Sell here</h4>
      <ul className="reminders__list">
        {lines.map((line) => (
          <SellReminder
            key={line.key}
            line={line}
            terminalById={terminalById}
            stops={stops}
            options={optionsFor(line)}
            onMove={(stop, unitSell) => onMove(line.key, stop, unitSell)}
          />
        ))}
      </ul>
    </div>
  )
}

/**
/**
 * One stop of the route: its buy options (top 5 plus every bought line), sell reminders for
 * earlier purchases, and the trip controls (DEPART →, UNDO). Departed stops collapse to a
 * header with a summary; the header expands them read-only.
 */
export function StopSection({
  index,
  stopCount,
  terminalId,
  options,
  terminalById,
  stops,
  freeScu,
  minBox,
  now,
  trip,
  onToggle,
  onDepart,
  onUndo,
  sellOptionsFor,
  onMoveReminder,
}: StopSectionProps) {
  const [showAll, setShowAll] = useState(false)
  const [reopened, setReopened] = useState(false)
  const section = useRef<HTMLElement>(null)

  const terminal = terminalById.get(terminalId)
  const display = terminal ? terminalDisplay(terminal) : undefined
  const last = index === stopCount - 1
  const departed = index < trip.currentStop
  const current = index === trip.currentStop
  const markable = current && !last

  // Bring a stop into view when it becomes the current one (after DEPART).
  const wasCurrent = useRef(current)
  useEffect(() => {
    if (current && !wasCurrent.current) section.current?.scrollIntoView?.({ block: 'start' })
    wasCurrent.current = current
  }, [current])

  const bought = boughtAt(trip, index)
  const boughtKeys = new Set(bought.map((b) => b.key))
  const items = stopItems(options, bought)
  const visible = showAll ? items : items.filter((item, i) => i < TOP_N || boughtKeys.has(item.key))
  const hidden = items.length - visible.length
  const reminders = remindersAt(trip, index)

  const toggleHaul = (haul: Haul) => onToggle(snapshotOf(haul, options.indexOf(haul)))

  const head = (
    <>
      <span className="stop__index num">{index + 1}</span>
      <div className="stop__text">
        <h3 className="stop__primary">{display?.primary ?? `Unknown terminal (#${terminalId})`}</h3>
        {display?.secondary && <div className="stop__secondary">{display.secondary}</div>}
        {departed && (
          <div className="stop-section__summary">
            <span className="badge badge--dim">DEPARTED</span> {summaryText(trip, index)}
          </div>
        )}
      </div>
    </>
  )

  const showBody = !departed || reopened

  return (
    <section
      ref={section}
      className={`stop-section${current ? ' stop-section--current' : ''}${departed ? ' stop-section--departed' : ''}`}
      aria-label={`Stop ${index + 1}`}
    >
      {departed ? (
        <div className="stop-section__head stop-section__head--departed">
          <button
            type="button"
            className="stop-section__toggle"
            aria-expanded={reopened}
            onClick={() => setReopened(!reopened)}
          >
            {head}
          </button>
          {index === trip.currentStop - 1 && (
            <button type="button" className="btn" onClick={onUndo}>
              Undo
            </button>
          )}
        </div>
      ) : (
        <header className="stop-section__head">{head}</header>
      )}

      {markable && (
        <button type="button" className="btn depart" onClick={onDepart}>
          Depart →
        </button>
      )}

      {showBody && (
        <div className="stop-section__body">
          <SellReminders
            lines={reminders}
            upcoming={!current}
            terminalById={terminalById}
            stops={stops}
            optionsFor={sellOptionsFor}
            onMove={onMoveReminder}
          />
          {last ? (
            <p className="muted stop-section__note">Final stop — sell only</p>
          ) : options.length === 0 && bought.length === 0 ? (
            <p className="muted stop-section__note">Nothing profitable to buy here</p>
          ) : (
            <>
              <ul className="options" aria-label={`Buy options at stop ${index + 1}`}>
                {visible.map((item) =>
                  item.kind === 'haul' ? (
                    <OptionLine
                      key={item.key}
                      haul={item.haul}
                      terminalById={terminalById}
                      stops={stops}
                      freeScu={freeScu}
                      minBox={minBox}
                      now={now}
                      bought={boughtKeys.has(
                        boughtKey(item.haul.from, item.haul.commodity.id, item.haul.to),
                      )}
                      onToggle={markable ? () => toggleHaul(item.haul) : undefined}
                    />
                  ) : (
                    <SnapshotLine
                      key={item.key}
                      line={item.line}
                      terminalById={terminalById}
                      stops={stops}
                      onToggle={markable ? () => onToggle(item.line) : undefined}
                    />
                  ),
                )}
              </ul>
              {(hidden > 0 || showAll) && (
                <button
                  type="button"
                  className="btn btn--block"
                  onClick={() => setShowAll(!showAll)}
                >
                  {showAll ? 'Show fewer' : `Show ${hidden} more`}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </section>
  )
}
