import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateUuid } from './uuid'

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('generateUuid', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses crypto.randomUUID when available', () => {
    const randomUUID = vi.fn(() => '5d8a7e6f-1234-4abc-9def-0123456789ab')
    vi.stubGlobal('crypto', { ...globalThis.crypto, randomUUID })

    expect(generateUuid()).toBe('5d8a7e6f-1234-4abc-9def-0123456789ab')
    expect(randomUUID).toHaveBeenCalledOnce()
  })

  it('builds a v4 uuid from getRandomValues when randomUUID is missing', () => {
    // Android WebViews in non-secure contexts expose getRandomValues but not
    // randomUUID; the consent dialog must still be able to mint an id.
    const realGetRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto)
    vi.stubGlobal('crypto', {
      getRandomValues: (array: Uint8Array) => realGetRandomValues(array),
    })

    const id = generateUuid()

    expect(id).toMatch(UUID_V4_PATTERN)
    expect(generateUuid()).not.toBe(id)
  })
})
