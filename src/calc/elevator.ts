import type { Terminal } from '../domain/types'
import { STD_BOX_SIZES } from '../domain/types'

/** Largest box a hangar or outpost cargo elevator takes (SPEC §6.3). */
export const ELEVATOR_MAX_BOX = 24

/** Why a terminal is limited to `ELEVATOR_MAX_BOX`: an outpost, or the small hangar. */
export type ElevatorReason = 'outpost' | 'smallHangar'

/** The stops whose elevator limit removed box sizes from a haul (§6.3 `elevatorCap`). */
export interface ElevatorCap {
  size: number
  /** Stop indices whose cap applied (buy and/or sell stop). */
  stops: number[]
  /** Parallel to `stops`. */
  reasons: ElevatorReason[]
}

/**
 * The elevator limit of one terminal (rules from the product owner; UEX has no hangar data):
 * planetary terminals outside a city always take ≤ 24 SCU; cities and stations only when the
 * ship lands in a small hangar, except stations with an external loading dock. `null` = no limit
 * (32 SCU, or a terminal we know nothing about).
 */
export function elevatorLimit(
  terminal: Terminal | undefined,
  smallHangar: boolean,
): ElevatorReason | null {
  if (!terminal) return null
  if (terminal.idCity <= 0 && terminal.idSpaceStation <= 0) return 'outpost'
  if (terminal.idCity <= 0 && terminal.hasLoadingDock) return null
  return smallHangar ? 'smallHangar' : null
}

/** Standard box sizes both terminals' elevators take. */
export function elevatorSizes(
  buyTerminal: Terminal | undefined,
  sellTerminal: Terminal | undefined,
  smallHangar: boolean,
): number[] {
  const limited =
    elevatorLimit(buyTerminal, smallHangar) !== null ||
    elevatorLimit(sellTerminal, smallHangar) !== null
  return limited ? STD_BOX_SIZES.filter((s) => s <= ELEVATOR_MAX_BOX) : [...STD_BOX_SIZES]
}
