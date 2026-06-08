import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { HttpClient } from 'isomorphic-git'
import {
  commitAll,
  getLastCommitInfo,
  getModifiedFiles,
  getRemoteStatus,
  hasRemote,
  initRepo,
  isGitRepo,
  pullFromRemote,
  pushToRemote,
  type GitContext,
} from './mobileGit'

// Local git operations run against Node's fs in a throwaway directory, so the
// tests exercise the real isomorphic-git engine without any network access.
const noopHttp = { request: async () => ({ url: '', method: 'GET', headers: {}, body: [] }) } as unknown as HttpClient

let dir: string

function context(): GitContext {
  return {
    fs: fs as unknown as GitContext['fs'],
    http: noopHttp,
    dir,
    author: { name: 'Tester', email: 'tester@example.com' },
  }
}

function write(relative: string, content: string): void {
  fs.writeFileSync(path.join(dir, relative), content)
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tolaria-git-'))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('repository lifecycle', () => {
  it('reports a non-repo directory and an initialized one', async () => {
    expect(await isGitRepo(context())).toBe(false)
    await initRepo(context())
    expect(await isGitRepo(context())).toBe(true)
    expect(await hasRemote(context())).toBe(false)
  })
})

describe('commitAll', () => {
  it('skips empty commits and commits real changes', async () => {
    await initRepo(context())
    expect(await commitAll(context(), 'empty')).toBeNull()

    write('note.md', '# Hello')
    const hash = await commitAll(context(), 'add note')
    expect(hash).toMatch(/^[0-9a-f]{40}$/)

    const info = await getLastCommitInfo(context())
    expect(info?.shortHash).toBe(hash?.slice(0, 7))
  })

  it('stages deletions', async () => {
    await initRepo(context())
    write('note.md', 'body')
    await commitAll(context(), 'add')
    fs.rmSync(path.join(dir, 'note.md'))
    const hash = await commitAll(context(), 'remove')
    expect(hash).not.toBeNull()
    expect(await getModifiedFiles(context())).toEqual([])
  })
})

describe('getModifiedFiles', () => {
  it('lists untracked and modified files', async () => {
    await initRepo(context())
    write('tracked.md', 'one')
    await commitAll(context(), 'init')
    write('tracked.md', 'a much longer body than before')
    write('fresh.md', 'new')

    const files = await getModifiedFiles(context())
    const byPath = Object.fromEntries(files.map((file) => [file.relativePath, file.status]))
    expect(byPath['tracked.md']).toBe('modified')
    expect(byPath['fresh.md']).toBe('untracked')
  })
})

describe('getLastCommitInfo', () => {
  it('returns null before any commit', async () => {
    await initRepo(context())
    expect(await getLastCommitInfo(context())).toBeNull()
  })
})

describe('remote-dependent operations without a remote', () => {
  it('reports default branch and missing remote', async () => {
    await initRepo(context())
    write('note.md', 'x')
    await commitAll(context(), 'init')
    const status = await getRemoteStatus(context())
    expect(status).toEqual({ branch: 'main', ahead: 0, behind: 0, hasRemote: false })
  })

  it('short-circuits push and pull when no remote is configured', async () => {
    await initRepo(context())
    expect((await pushToRemote(context())).status).toBe('no_remote')
    expect((await pullFromRemote(context())).status).toBe('no_remote')
  })
})
