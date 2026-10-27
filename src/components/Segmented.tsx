interface SegmentedProps {
  label: string
  options: number[]
  value: number
  onChange: (value: number) => void
}

/** Segmented radio group (e.g. max box size). */
export function Segmented({ label, options, value, onChange }: SegmentedProps) {
  return (
    <div role="radiogroup" aria-label={label} className="seg seg--boxes">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          className="seg__btn num"
          onClick={() => onChange(option)}
        >
          {option}
        </button>
      ))}
    </div>
  )
}
