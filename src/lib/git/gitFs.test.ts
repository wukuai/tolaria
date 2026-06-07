import { describe, expect, it, vi } from 'vitest'
import { createGitFs, toGitStat, type GitFileInfo, type GitFsBackend } from './gitFs'

function fileInfo(overrides: Partial<GitFileInfo> = {}): GitFileInfo {
  return { isFile: true, isDirectory: false, isSymlink: false, size: 4, mtimeMs: 1000, ...overrides }
}

describe('toGitStat', () => {
  it('reports file metadata', () => {
    const stat = toGitStat(fileInfo())
    expect(stat.isFile()).toBe(true)
    expect(stat.isDirectory()).toBe(false)
    expect(stat.mode).toBe(0o100644)
    expect(stat.mtimeMs).toBe(1000)
    expect(stat.ctimeMs).toBe(1000)
  })

  it('reports directory and symlink types', () => {
    expect(toGitStat(fileInfo({ isDirectory: true, isFile: false })).isDirectory()).toBe(true)
    expect(toGitStat(fileInfo({ isSymlink: true, isFile: false })).isSymbolicLink()).toBe(true)
  })

  it('defaults a missing mtime to zero', () => {
    expect(toGitStat(fileInfo({ mtimeMs: null })).mtimeMs).toBe(0)
  })
})

function memoryBackend(initial: Record<string, Uint8Array> = {}): GitFsBackend {
  const files = new Map(Object.entries(initial))
  return {
    readFile: async (path) => {
      const data = files.get(path)
      if (!data) throw new Error('backend failure')
      return data
    },
    writeFile: async (path, data) => {
      files.set(path, data)
    },
    unlink: async (path) => {
      files.delete(path)
    },
    rmdir: vi.fn(async () => {}),
    mkdir: vi.fn(async () => {}),
    readdir: async () => [...files.keys()],
    stat: async () => fileInfo(),
    exists: async (path) => files.has(path),
  }
}

describe('createGitFs', () => {
  it('round-trips file content with and without encoding', async () => {
    const { promises } = createGitFs(memoryBackend())
    await promises.writeFile('/a.txt', 'hello')
    expect(await promises.readFile('/a.txt', { encoding: 'utf8' })).toBe('hello')
    expect(ArrayBuffer.isView(await promises.readFile('/a.txt'))).toBe(true)
  })

  it('surfaces missing files as ENOENT', async () => {
    const { promises } = createGitFs(memoryBackend())
    await expect(promises.readFile('/missing.txt')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rethrows backend errors when the path exists', async () => {
    const backend = memoryBackend()
    backend.readFile = async () => {
      throw new Error('disk on fire')
    }
    backend.exists = async () => true
    const { promises } = createGitFs(backend)
    await expect(promises.readFile('/a.txt')).rejects.toThrow('disk on fire')
  })

  it('maps stat to a git stat object', async () => {
    const { promises } = createGitFs(memoryBackend({ '/a.txt': new Uint8Array([1]) }))
    const stat = (await promises.stat('/a.txt')) as { isFile(): boolean }
    expect(stat.isFile()).toBe(true)
  })
})
