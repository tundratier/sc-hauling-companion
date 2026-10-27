/**
 * Inventory status scale from `GET /commodities_status` (SPEC §4.3), embedded to save a
 * request. Used only for labels and warnings — never to filter, cap or rank trades.
 */
export interface StatusInfo {
  abbr: string
  label: string
}

/** `status_buy`: stock at the terminal the player buys from. */
export const BUY_STATUS: Record<number, StatusInfo> = {
  1: { abbr: 'OS', label: 'Out of Stock (0–14 %)' },
  2: { abbr: 'VL', label: 'Very Low (15–28 %)' },
  3: { abbr: 'LO', label: 'Low (29–43 %)' },
  4: { abbr: 'ME', label: 'Medium (44–57 %)' },
  5: { abbr: 'HI', label: 'High (58–71 %)' },
  6: { abbr: 'VH', label: 'Very High (72–85 %)' },
  7: { abbr: 'MA', label: 'Maximum' },
}

/** `status_sell`: how much the terminal still wants the commodity. */
export const SELL_STATUS: Record<number, StatusInfo> = {
  1: { abbr: 'OS', label: 'Out of Stock (0–14 %) — terminal wants it' },
  2: { abbr: 'VL', label: 'Very Low (15–28 %)' },
  3: { abbr: 'LO', label: 'Low (29–43 %)' },
  4: { abbr: 'ME', label: 'Medium (44–57 %)' },
  5: { abbr: 'HI', label: 'High (58–71 %)' },
  6: { abbr: 'VH', label: 'Very High (72–85 %)' },
  7: { abbr: 'ND', label: 'Maximum, No Demand' },
}

export type InventoryWarningKind = 'noStock' | 'lowStock' | 'noDemand' | 'lowDemand'

/** Badge text — the question mark says the data is reported, not live. */
export const WARNING_LABEL: Record<InventoryWarningKind, string> = {
  noStock: 'NO STOCK?',
  lowStock: 'LOW STOCK?',
  noDemand: 'NO DEMAND?',
  lowDemand: 'LOW DEMAND?',
}
