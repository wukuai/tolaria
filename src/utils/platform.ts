import { isTauri } from '../mock-tauri'

function getUserAgent(): string {
  if (typeof navigator === 'undefined') return ''
  return navigator.userAgent
}

export function isLinux(): boolean {
  const userAgent = getUserAgent()
  return userAgent.includes('Linux') && !userAgent.includes('Android')
}

export function isMac(): boolean {
  const userAgent = getUserAgent()
  return userAgent.includes('Mac OS X') || userAgent.includes('Macintosh')
}

export function isWindows(): boolean {
  return getUserAgent().includes('Windows')
}

export function isAndroid(): boolean {
  return getUserAgent().includes('Android')
}

export function isIOS(): boolean {
  const userAgent = getUserAgent()
  return /iPhone|iPad|iPod/.test(userAgent)
}

export function isMobile(): boolean {
  return isAndroid() || isIOS()
}

export function shouldUseCustomWindowChrome(): boolean {
  return isTauri() && (isLinux() || isWindows())
}

/**
 * True when running inside the native shell on a mobile device, where the
 * system `git` binary is unavailable and git sync must run in-process
 * (isomorphic-git) instead of through the desktop Rust git commands.
 */
export function shouldUseInProcessGit(): boolean {
  return isTauri() && isMobile()
}
