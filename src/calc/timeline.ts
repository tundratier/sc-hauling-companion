import { onBoardPerSegment } from './plans'
import type { BoxCount, LoadPart, Plan } from './types'

export interface TimelineAction {
  type: 'buy' | 'sell'
  part: LoadPart
  qty: number
  commodityName: string
  unitPrice: number
  /** unitPrice × qty. */
  total: number
  /** Sell lines: profit of this part. */
  profit?: number
  /** Buy lines: box breakdown. */
  boxes?: BoxCount[]
}

/** One stop of the execution checklist (§6.6). */
export interface TimelineStop {
  index: number
  terminalId: number
  /** Sells first, then buys. */
  actions: TimelineAction[]
  /** SCU on board when arriving at the stop. */
  onBoardArriving: number
  /** SCU on board when leaving the stop. */
  onBoardLeaving: number
  /** Nothing to buy or sell here. */
  passThrough: boolean
}

export function buildTimeline(plan: Plan, stops: number[]): TimelineStop[] {
  const segments = onBoardPerSegment(plan.loads, stops.length)
  return stops.map((terminalId, index) => {
    const actions: TimelineAction[] = []
    for (const load of plan.loads) {
      if (load.to !== index) continue
      for (const part of load.parts) {
        actions.push({
          type: 'sell',
          part,
          qty: part.qty,
          commodityName: part.haul.commodity.name,
          unitPrice: part.haul.unitSell,
          total: part.revenue,
          profit: part.profit,
        })
      }
    }
    for (const load of plan.loads) {
      if (load.from !== index) continue
      for (const part of load.parts) {
        actions.push({
          type: 'buy',
          part,
          qty: part.qty,
          commodityName: part.haul.commodity.name,
          unitPrice: part.haul.unitBuy,
          total: part.investment,
          boxes: part.boxes,
        })
      }
    }
    return {
      index,
      terminalId,
      actions,
      onBoardArriving: index > 0 ? segments[index - 1] : 0,
      onBoardLeaving: index < segments.length ? segments[index] : 0,
      passThrough: actions.length === 0,
    }
  })
}
