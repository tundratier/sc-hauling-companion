import { useId } from 'react'
import { formatInt } from '../lib/format'
import { Icon } from './Icon'

interface BudgetFieldProps {
  /** aUEC for one load; null = no limit. */
  value: number | null
  onChange: (budget: number | null) => void
}

/** Whole aUEC from what was typed: digits only, so `250,000` and `250000` agree; empty → null. */
export const parseBudget = (text: string): number | null => {
  const digits = text.replace(/\D/g, '')
  const n = digits === '' ? 0 : Number(digits)
  return n >= 1 && Number.isSafeInteger(n) ? n : null
}

/** Optional budget input with digit grouping and a clear button (SPEC §7.3). */
export function BudgetField({ value, onChange }: BudgetFieldProps) {
  const id = useId()
  return (
    <div>
      <label className="label" htmlFor={id}>
        Budget (aUEC)
      </label>
      <div className="row">
        <input
          id={id}
          className="input grow"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="no limit"
          value={value === null ? '' : formatInt(value)}
          onChange={(e) => onChange(parseBudget(e.target.value))}
        />
        {value !== null && (
          <button
            type="button"
            className="btn btn--icon"
            aria-label="Clear budget"
            onClick={() => onChange(null)}
          >
            <Icon name="close" />
          </button>
        )}
      </div>
      <p className="muted fineprint">
        Max aUEC for one load. More expensive trades are shown with the load you can afford.
      </p>
    </div>
  )
}
