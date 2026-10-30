import { describe, expect, it } from 'vitest'
import { fitList } from './Combobox'

// a 48 px tall field at the given top, in an 800 px tall viewport
const field = (top: number) => new DOMRect(0, top, 300, 48)
const bar = (top: number, height: number) => new DOMRect(0, top, 300, height)

describe('fitList (placement auto)', () => {
  it('opens downwards when there is room below the field', () => {
    expect(fitList(field(200), 0, 800, [])).toEqual({ side: 'down', maxHeight: 380 })
  })

  it('stops above bottom bars (tab bar, sticky action) instead of the viewport edge', () => {
    // field bottom 448; sticky action starts at 680 → 680 − 448 − 12 = 220
    const fit = fitList(field(400), 0, 800, [bar(680, 60), bar(740, 60)])
    expect(fit).toEqual({ side: 'down', maxHeight: 220 })
  })

  it('opens upwards when the space below is short and above is larger', () => {
    // on-screen keyboard: visual viewport ends at 520; field bottom 498 → 10 px below
    expect(fitList(field(450), 0, 520, [])).toEqual({ side: 'up', maxHeight: 380 })
  })

  it('ignores bars above the field and fits the list into the chosen side', () => {
    const fit = fitList(field(560), 0, 800, [bar(0, 60)])
    // below: 800 − 608 − 12 = 180 → down, capped to the space
    expect(fit).toEqual({ side: 'down', maxHeight: 180 })
  })
})
