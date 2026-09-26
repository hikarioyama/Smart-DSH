import { describe, expect, it } from 'vitest'
import { BOOKMARK_BAR_PX, btwTopLimit, clampHeight, isPhoneViewport, transcriptHeightForTop } from '../src/client/ui/panel-bounds.js'

describe('BTW panel ceiling', () => {
  it('treats a coarse pointer or a narrow width as a phone', () => {
    expect(isPhoneViewport(true, 1280)).toBe(true)
    expect(isPhoneViewport(false, 390)).toBe(true)
    expect(isPhoneViewport(false, 1024)).toBe(false)
  })

  it('keeps the phone ceiling below a bookmarks bar, and the desktop ceiling inside the viewport', () => {
    expect(btwTopLimit(true, 0)).toBe(BOOKMARK_BAR_PX)
    expect(btwTopLimit(true, 59)).toBe(59)
    expect(btwTopLimit(false, 0)).toBe(8)
  })

  it('shrinks a transcript whose handle has gone under the bookmarks bar', () => {
    expect(transcriptHeightForTop(420, -30, 48)).toBe(342)
  })

  it('still allows dragging up until the handle meets the bar', () => {
    expect(transcriptHeightForTop(180, 200, 48)).toBe(332)
  })

  it('never lets a measured ceiling or the 70% cap drop the transcript below 100', () => {
    expect(clampHeight(900, 800, 120)).toBe(120)
    expect(clampHeight(40, 800, 400)).toBe(100)
    expect(clampHeight(900, 800)).toBe(560)
  })
})
