export interface RowBox {
  top: number
  bottom: number
}

/**
 * Index of the row under pointer position `y` (clamped to the first/last row), used by the
 * drag-to-reorder handle on the route list.
 */
export function indexAtY(rows: RowBox[], y: number): number {
  if (rows.length === 0) return -1
  if (y <= rows[0].top) return 0
  for (let i = 0; i < rows.length; i++) {
    if (y >= rows[i].top && y < rows[i].bottom) return i
  }
  return rows.length - 1
}
