import { beforeEach, describe, expect, it, vi } from 'vitest'

// Network-touching operations are covered by mocking isomorphic-git so we can
// drive success, rejection, and failure paths deterministically and offline.
const git = vi.hoisted(() => ({
  push: vi.fn(),
  pull: vi.fn(),
  clone: vi.fn(),
  listRemotes: vi.fn(),
  addRemote: vi.fn(),
  fetch: vi.fn(),
}))

vi.mock('isomorphic-git', () => git)

import { addRemoteAndFetch, cloneRepo, pullFromRemote, pushToRemote, type GitContext } from './mobileGit'

const ctx = {
  fs: {},
  http: {},
  dir: '/vault',
  author: { name: 'T', email: 't@e.co' },
} as unknown as GitContext

beforeEach(() => {
  vi.clearAllMocks()
  git.listRemotes.mockResolvedValue([{ remote: 'origin', url: 'https://example.com/repo.git' }])
})

describe('pushToRemote', () => {
  it('returns ok on a successful push', async () => {
    git.push.mockResolvedValue({ ok: true })
    expect(await pushToRemote(ctx)).toEqual({ status: 'ok', message: 'Pushed to remote' })
  })

  it('returns rejected when the remote refuses', async () => {
    git.push.mockResolvedValue({ ok: false, error: 'non-fast-forward' })
    expect(await pushToRemote(ctx)).toEqual({ status: 'rejected', message: 'non-fast-forward' })
  })

  it('classifies thrown transport errors', async () => {
    git.push.mockRejectedValue({ code: 'HttpError', message: 'down' })
    expect((await pushToRemote(ctx)).status).toBe('network_error')
  })

  it('reports no_remote when none is configured', async () => {
    git.listRemotes.mockResolvedValue([])
    expect((await pushToRemote(ctx)).status).toBe('no_remote')
    expect(git.push).not.toHaveBeenCalled()
  })
})

describe('pullFromRemote', () => {
  it('returns updated on success', async () => {
    git.pull.mockResolvedValue(undefined)
    expect((await pullFromRemote(ctx)).status).toBe('updated')
  })

  it('classifies merge conflicts', async () => {
    git.pull.mockRejectedValue({ code: 'MergeNotSupportedError' })
    expect((await pullFromRemote(ctx)).status).toBe('conflict')
  })

  it('reports no_remote when none is configured', async () => {
    git.listRemotes.mockResolvedValue([])
    expect((await pullFromRemote(ctx)).status).toBe('no_remote')
  })
})

describe('cloneRepo', () => {
  it('delegates to isomorphic-git clone', async () => {
    git.clone.mockResolvedValue(undefined)
    await cloneRepo(ctx, 'https://example.com/repo.git')
    expect(git.clone).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://example.com/repo.git', singleBranch: true }),
    )
  })
})

describe('addRemoteAndFetch', () => {
  it('connects a new remote', async () => {
    git.listRemotes.mockResolvedValue([])
    git.addRemote.mockResolvedValue(undefined)
    git.fetch.mockResolvedValue(undefined)
    expect((await addRemoteAndFetch(ctx, 'https://example.com/repo.git')).status).toBe('connected')
  })

  it('reports an already configured remote', async () => {
    expect((await addRemoteAndFetch(ctx, 'https://example.com/repo.git')).status).toBe('already_configured')
  })

  it('classifies failures', async () => {
    git.listRemotes.mockResolvedValue([])
    git.addRemote.mockRejectedValue({ data: { statusCode: 401 } })
    expect((await addRemoteAndFetch(ctx, 'https://example.com/repo.git')).status).toBe('auth_error')
  })
})
