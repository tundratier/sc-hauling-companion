import { useRef, type KeyboardEvent } from 'react'
import { TABS, type Tab } from '../state/useAppStore'
import { Icon } from './Icon'

interface TabBarProps {
  tab: Tab
  onChange: (tab: Tab) => void
}

export const tabId = (tab: Tab) => `tab-${tab}`
export const panelId = (tab: Tab) => `panel-${tab}`

/** Bottom tab bar: SHIP · ROUTE · TRADES (WAI-ARIA tabs with arrow-key support). */
export function TabBar({ tab, onChange }: TabBarProps) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})

  const onKeyDown = (e: KeyboardEvent, index: number) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const next = TABS[(index + step + TABS.length) % TABS.length].id
    onChange(next)
    refs.current[next]?.focus()
  }

  return (
    <nav className="tabbar" aria-label="Views" data-bottom-overlay>
      <div className="tabbar__inner" role="tablist">
        {TABS.map(({ id, label }, index) => (
          <button
            key={id}
            ref={(el) => {
              refs.current[id] = el
            }}
            type="button"
            role="tab"
            id={tabId(id)}
            className="tab"
            aria-selected={tab === id}
            aria-controls={panelId(id)}
            tabIndex={tab === id ? 0 : -1}
            onClick={() => onChange(id)}
            onKeyDown={(e) => onKeyDown(e, index)}
          >
            <Icon name={id} />
            {label}
          </button>
        ))}
      </div>
    </nav>
  )
}
