export type IconName = 'ship' | 'route' | 'trades' | 'refresh'

const PATHS: Record<IconName, string> = {
  // simple stroked glyphs on a 24 px grid
  ship: 'M12 3 4 19l8-3 8 3L12 3Z',
  route:
    'M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm12-10a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM8 17h5a3 3 0 0 0 3-3v0a3 3 0 0 0-3-3h-2a3 3 0 0 1-3-3v0a3 3 0 0 1 3-3h5',
  trades: 'M4 8h13m0 0-3-3m3 3-3 3M20 16H7m0 0 3-3m-3 3 3 3',
  refresh: 'M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5',
}

export function Icon({ name }: { name: IconName }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
