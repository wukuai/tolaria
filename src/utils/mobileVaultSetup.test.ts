import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
const runGitCommand = vi.hoisted(() => vi.fn())
const shouldUseInProcessGit = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('../lib/git', () => ({ runGitCommand }))
vi.mock('./platform', () => ({ shouldUseInProcessGit }))

import {
  cloneTemplateVaultInProcess,
  mobileEmptyVaultTarget,
  mobileTemplateVaultTarget,
  usesMobileVaultSetup,
} from './mobileVaultSetup'

beforeEach(() => {
  vi.clearAllMocks()
  shouldUseInProcessGit.mockReturnValue(true)
})

describe('usesMobileVaultSetup', () => {
  it('mirrors the in-process git platform check', () => {
    expect(usesMobileVaultSetup()).toBe(true)
    shouldUseInProcessGit.mockReturnValue(false)
    expect(usesMobileVaultSetup()).toBe(false)
  })
})

describe('mobile vault targets', () => {
  it('uses the backend default path for the template vault', async () => {
    invoke.mockResolvedValue('/data/app/Documents/Getting Started')
    expect(await mobileTemplateVaultTarget()).toBe('/data/app/Documents/Getting Started')
    expect(invoke).toHaveBeenCalledWith('get_default_vault_path', {})
  })

  it('places the empty vault next to the default vault', async () => {
    invoke.mockResolvedValue('/data/app/Documents/Getting Started')
    expect(await mobileEmptyVaultTarget()).toBe('/data/app/Documents/My Vault')
  })
})

describe('cloneTemplateVaultInProcess', () => {
  it('clones through the in-process engine, then repairs vault config', async () => {
    runGitCommand.mockResolvedValue(null)
    invoke.mockResolvedValue('Vault repaired')

    const path = await cloneTemplateVaultInProcess('/data/app/Documents/Getting Started')

    expect(runGitCommand).toHaveBeenCalledWith('clone_git_repo', {
      vaultPath: '/data/app/Documents/Getting Started',
      url: 'https://github.com/refactoringhq/tolaria-getting-started.git',
    })
    expect(invoke).toHaveBeenCalledWith('repair_vault', {
      vaultPath: '/data/app/Documents/Getting Started',
    })
    expect(path).toBe('/data/app/Documents/Getting Started')
  })

  it('propagates clone failures without attempting repair', async () => {
    runGitCommand.mockRejectedValue(new Error('could not resolve host'))

    await expect(cloneTemplateVaultInProcess('/x')).rejects.toThrow('could not resolve host')
    expect(invoke).not.toHaveBeenCalled()
  })
})
