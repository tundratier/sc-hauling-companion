import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

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
  /** Where the list opens; `up` keeps it above the on-screen keyboard. */
  placement?: 'up' | 'down'
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
  placement = 'down',
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
    <div className={`combobox combobox--${placement}`}>
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
