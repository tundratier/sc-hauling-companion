import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react'

/** Matches `.combobox__list { max-height: min(50vh, 380px) }`. */
const LIST_MAX = 380
/** Below this, the list opens on the side with more room instead. */
const LIST_MIN = 180
/** List margin (4 px) plus a little air to the edge. */
const EDGE = 12

interface Fit {
  side: 'up' | 'down'
  maxHeight: number
}

/** Free space below and above `field`, inside the visual viewport and above bottom bars. */
export function fitList(field: DOMRect, viewTop: number, viewBottom: number, bars: DOMRect[]): Fit {
  const bottom = Math.min(
    viewBottom,
    ...bars.filter((b) => b.top >= field.bottom).map((b) => b.top),
  )
  const below = bottom - field.bottom - EDGE
  const above = field.top - viewTop - EDGE
  const side = below >= LIST_MIN || below >= above ? 'down' : 'up'
  const space = side === 'down' ? below : above
  return { side, maxHeight: Math.max(LIST_MIN / 2, Math.min(LIST_MAX, space)) }
}

function measure(input: HTMLElement): Fit {
  const vv = window.visualViewport
  const viewTop = vv ? vv.offsetTop : 0
  const viewBottom = vv ? vv.offsetTop + vv.height : window.innerHeight
  const bars = [...document.querySelectorAll('[data-bottom-overlay]')].map((el) =>
    el.getBoundingClientRect(),
  )
  return fitList(input.getBoundingClientRect(), viewTop, viewBottom, bars)
}

interface ComboboxProps<T> {
  label: string
  placeholder?: string
  /** Local search; called on every keystroke, returns the options to show. */
  search: (query: string) => T[]
  getKey: (item: T) => string | number
  /** Primary and secondary lines of an option. */
  renderOption: (item: T) => { primary: ReactNode; secondary?: ReactNode }
  onSelect: (item: T) => void
  /** Text shown while the field is not being edited (e.g. the selected ship). */
  value?: string
  /** Clear the field after a selection and keep focus (for "add stop"). */
  clearOnSelect?: boolean
  /**
   * Where the list opens. `auto` measures the free space below and above the field (visual
   * viewport, so the on-screen keyboard counts, minus `[data-bottom-overlay]` bars) and picks the
   * side that fits.
   */
  placement?: 'up' | 'down' | 'auto'
  emptyText?: string
  disabled?: boolean
}

/** Combobox ARIA pattern: ↑ ↓ Enter Esc, overlay listbox, 1-character start. */
export function Combobox<T>({
  label,
  placeholder,
  search,
  getKey,
  renderOption,
  onSelect,
  value = '',
  clearOnSelect = false,
  placement = 'auto',
  emptyText = 'No matches',
  disabled,
}: ComboboxProps<T>) {
  const uid = useId()
  const listId = `${uid}-list`
  const inputRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState(value)
  const [editing, setEditing] = useState(false)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)

  const query = editing ? text : ''
  const results = open && query.trim() ? search(query) : []
  const showList = open && query.trim() !== ''
  const optionId = (i: number) => `${uid}-opt-${i}`

  // `auto`: re-measure while the list is open (keyboard opening, scrolling, resizing).
  const [fit, setFit] = useState<Fit | null>(null)
  useEffect(() => {
    if (placement !== 'auto' || !showList || !inputRef.current) return undefined
    const input = inputRef.current
    const update = () => setFit(measure(input))
    update()
    const vv = window.visualViewport
    vv?.addEventListener('resize', update)
    vv?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      vv?.removeEventListener('resize', update)
      vv?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [placement, showList])
  const side = placement === 'auto' ? (fit?.side ?? 'down') : placement
  const listStyle: CSSProperties | undefined =
    placement === 'auto' && fit ? { maxHeight: fit.maxHeight } : undefined

  const choose = (item: T) => {
    onSelect(item)
    setOpen(false)
    setActive(0)
    if (clearOnSelect) {
      setText('')
      setEditing(true) // stay in "editing" so the field remains empty and focused
      inputRef.current?.focus()
    } else {
      setEditing(false)
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActive((i) => (results.length ? Math.min(results.length - 1, i + 1) : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      if (showList && results[active]) {
        e.preventDefault()
        choose(results[active])
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className={`combobox combobox--${side}`}>
      <label className="label" htmlFor={`${uid}-input`}>
        {label}
      </label>
      <input
        ref={inputRef}
        id={`${uid}-input`}
        className="input"
        type="text"
        role="combobox"
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="done"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && results[active] ? optionId(active) : undefined}
        placeholder={placeholder}
        disabled={disabled}
        value={editing ? text : value}
        onFocus={(e) => {
          setText(value)
          setEditing(true)
          if (!clearOnSelect) e.currentTarget.select()
        }}
        onBlur={() => {
          setEditing(false)
          setOpen(false)
        }}
        onChange={(e) => {
          setText(e.target.value)
          setEditing(true)
          setOpen(true)
          setActive(0)
        }}
        onKeyDown={onKeyDown}
      />
      {showList && (
        <ul
          id={listId}
          className="combobox__list"
          style={listStyle}
          role="listbox"
          aria-label={`${label} suggestions`}
          // keep focus in the input while tapping an option
          onMouseDown={(e) => e.preventDefault()}
        >
          {results.length === 0 && (
            <li className="combobox__empty" role="presentation">
              {emptyText}
            </li>
          )}
          {results.map((item, i) => {
            const { primary, secondary } = renderOption(item)
            return (
              <li
                key={getKey(item)}
                id={optionId(i)}
                role="option"
                aria-selected={i === active}
                className="combobox__option"
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(item)}
              >
                <span className="combobox__primary">{primary}</span>
                {secondary && <span className="combobox__secondary">{secondary}</span>}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
