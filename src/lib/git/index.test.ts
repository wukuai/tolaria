import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }))

const shouldUseInProcessGit = vi.fn()
vi.mock('../../utils/platform', () => ({ shouldUseInProcessGit: () => shouldUseInProcessGit() }))

import {
  dispatchMobileGit,
  runGitCommand,
  setMobileGitToken,
  UnsupportedGitCommandError,
  type MobileGitDeps,
} from './index'
import type { GitContext } from './mobileGit'

const fakeContext = { dir: '/vault' } as unknown as GitContext

function deps(handler: ReturnType<typeof vi.fn>): MobileGitDeps {
  return {
    makeContext: vi.fn(async () => fakeContext),
    handlers: { git_commit: handler },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('dispatchMobileGit', () => {
  it('builds a context from the vault path and runs the handler', async () => {
    const handler = vi.fn(async () => 'abc123')
    const testDeps = deps(handler)
    const result = await dispatchMobileGit<string>('git_commit', { vaultPath: '/vault', message: 'm' }, testDeps)
    expect(result).toBe('abc123')
    expect(testDeps.makeContext).toHaveBeenCalledWith('/vault')
    expect(handler).toHaveBeenCalledWith(fakeContext, { vaultPath: '/vault', message: 'm' })
  })

  it('accepts a path argument as the vault directory', async () => {
    const testDeps = deps(vi.fn(async () => null))
    await dispatchMobileGit('git_commit', { path: '/other' }, testDeps)
    expect(testDeps.makeContext).toHaveBeenCalledWith('/other')
  })

  it('throws when no vault path is provided', async () => {
    await expect(dispatchMobileGit('git_commit', {}, deps(vi.fn()))).rejects.toThrow('vault path is required')
  })

  it('throws for unsupported commands', async () => {
    await expect(dispatchMobileGit('unknown', { path: '/v' }, deps(vi.fn()))).rejects.toBeInstanceOf(
      UnsupportedGitCommandError,
    )
  })
})

describe('runGitCommand', () => {
  it('uses Tauri invoke on desktop', async () => {
    shouldUseInProcessGit.mockReturnValue(false)
    invoke.mockResolvedValue('desktop-result')
    expect(await runGitCommand('git_push', { vaultPath: '/v' })).toBe('desktop-result')
    expect(invoke).toHaveBeenCalledWith('git_push', { vaultPath: '/v' })
  })

  it('routes to the in-process engine on mobile', async () => {
    shouldUseInProcessGit.mockReturnValue(true)
    await expect(runGitCommand('unknown_cmd', { path: '/v' })).rejects.toBeInstanceOf(UnsupportedGitCommandError)
    expect(invoke).not.toHaveBeenCalled()
  })
})

describe('setMobileGitToken', () => {
  it('persists the token to localStorage', () => {
    setMobileGitToken('ghp_test')
    expect(globalThis.localStorage.getItem('tolaria.git.token')).toBe('ghp_test')
  })
})
