import { afterEach, describe, expect, it, vi } from 'vitest'
import { isTauri } from '../mock-tauri'
import {
  isAndroid,
  isIOS,
  isLinux,
  isMac,
  isMobile,
  isWindows,
  shouldUseCustomWindowChrome,
  shouldUseInProcessGit,
} from './platform'

vi.mock('../mock-tauri', () => ({
  isTauri: vi.fn(),
}))

const originalUserAgent = navigator.userAgent

function setUserAgent(userAgent: string) {
  Object.defineProperty(window.navigator, 'userAgent', {
    configurable: true,
    value: userAgent,
  })
}

describe('platform helpers', () => {
  afterEach(() => {
    setUserAgent(originalUserAgent)
    vi.mocked(isTauri).mockReturnValue(false)
  })

  it('detects Linux user agents but ignores Android', () => {
    setUserAgent('Mozilla/5.0 (X11; Linux x86_64)')
    expect(isLinux()).toBe(true)

    setUserAgent('Mozilla/5.0 (Linux; Android 14)')
    expect(isLinux()).toBe(false)
  })

  it('detects macOS user agents', () => {
    setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')
    expect(isMac()).toBe(true)
  })

  it('detects Windows user agents', () => {
    setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')
    expect(isWindows()).toBe(true)

    setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')
    expect(isWindows()).toBe(false)
  })

  it('detects Android user agents', () => {
    setUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8)')
    expect(isAndroid()).toBe(true)
    expect(isMobile()).toBe(true)

    setUserAgent('Mozilla/5.0 (X11; Linux x86_64)')
    expect(isAndroid()).toBe(false)
  })

  it('detects iOS user agents', () => {
    setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')
    expect(isIOS()).toBe(true)
    expect(isMobile()).toBe(true)

    setUserAgent('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')
    expect(isIOS()).toBe(true)

    setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')
    expect(isIOS()).toBe(false)
  })

  it('uses in-process git only on mobile inside Tauri', () => {
    setUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8)')
    vi.mocked(isTauri).mockReturnValue(false)
    expect(shouldUseInProcessGit()).toBe(false)

    vi.mocked(isTauri).mockReturnValue(true)
    expect(shouldUseInProcessGit()).toBe(true)

    setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')
    expect(shouldUseInProcessGit()).toBe(false)
  })

  it('enables custom desktop chrome on Linux and Windows inside Tauri', () => {
    setUserAgent('Mozilla/5.0 (X11; Linux x86_64)')
    vi.mocked(isTauri).mockReturnValue(false)
    expect(shouldUseCustomWindowChrome()).toBe(false)

    vi.mocked(isTauri).mockReturnValue(true)
    expect(shouldUseCustomWindowChrome()).toBe(true)

    setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')
    expect(shouldUseCustomWindowChrome()).toBe(true)

    setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')
    expect(shouldUseCustomWindowChrome()).toBe(false)
  })
})
