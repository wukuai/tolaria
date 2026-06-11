/**
 * Bridges a minimal device-filesystem backend onto the filesystem client shape
 * isomorphic-git expects (`{ promises: { ... } }`).
 *
 * The bridge is intentionally pure: it depends only on the {@link GitFsBackend}
 * interface, never on Tauri directly, so it can be exercised with an in-memory
 * backend in tests. The native Tauri wiring lives in `tauriGitFs.ts`.
 */

export interface GitFileInfo {
  isFile: boolean
  isDirectory: boolean
  isSymlink: boolean
  size: number
  /** Last-modified time in milliseconds since the epoch, or null when unknown. */
  mtimeMs: number | null
}

export interface GitFsBackend {
  readFile(path: string): Promise<Uint8Array>
  writeFile(path: string, data: Uint8Array): Promise<void>
  unlink(path: string): Promise<void>
  mkdir(path: string): Promise<void>
  rmdir(path: string): Promise<void>
  readdir(path: string): Promise<string[]>
  stat(path: string): Promise<GitFileInfo>
  exists(path: string): Promise<boolean>
}

interface GitStat {
  type: 'file' | 'dir' | 'symlink'
  mode: number
  size: number
  mtimeMs: number
  ctimeMs: number
  uid: number
  gid: number
  dev: number
  ino: number
  isFile(): boolean
  isDirectory(): boolean
  isSymbolicLink(): boolean
}

const FILE_MODE = 0o100644
const DIR_MODE = 0o040000
const SYMLINK_MODE = 0o120000

function statType(info: GitFileInfo): GitStat['type'] {
  if (info.isDirectory) return 'dir'
  if (info.isSymlink) return 'symlink'
  return 'file'
}

function statMode(type: GitStat['type']): number {
  if (type === 'dir') return DIR_MODE
  if (type === 'symlink') return SYMLINK_MODE
  return FILE_MODE
}

export function toGitStat(info: GitFileInfo): GitStat {
  const type = statType(info)
  const mtimeMs = info.mtimeMs ?? 0
  return {
    type,
    mode: statMode(type),
    size: info.size,
    mtimeMs,
    ctimeMs: mtimeMs,
    uid: 0,
    gid: 0,
    dev: 0,
    ino: 0,
    isFile: () => type === 'file',
    isDirectory: () => type === 'dir',
    isSymbolicLink: () => type === 'symlink',
  }
}

interface NodeError extends Error {
  code: string
}

function notFoundError(path: string): NodeError {
  const error = new Error(`ENOENT: no such file or directory, '${path}'`) as NodeError
  error.code = 'ENOENT'
  return error
}

const decoder = new TextDecoder()
const encoder = new TextEncoder()

interface ReadFileOptions {
  encoding?: string
}

interface WriteFileOptions {
  encoding?: string
}

export interface GitFsPromises {
  readFile(path: string, options?: ReadFileOptions): Promise<Uint8Array | string>
  writeFile(path: string, data: Uint8Array | string, options?: WriteFileOptions): Promise<void>
  unlink(path: string): Promise<void>
  readdir(path: string): Promise<string[]>
  mkdir(path: string): Promise<void>
  rmdir(path: string): Promise<void>
  stat(path: string): Promise<GitStat>
  lstat(path: string): Promise<GitStat>
  readlink(path: string): Promise<string>
  symlink(target: string, path: string): Promise<void>
}

function toBytes(data: Uint8Array | string): Uint8Array {
  return typeof data === 'string' ? encoder.encode(data) : data
}

/**
 * Wraps a {@link GitFsBackend} so that "missing path" failures surface as
 * `ENOENT`-coded errors — isomorphic-git relies on that code to detect absent
 * files (e.g. probing for `.git/config`) rather than treating them as fatal.
 */
function withNotFound<T>(backend: GitFsBackend, path: string, run: () => Promise<T>): Promise<T> {
  return run().catch(async (error) => {
    if (!(await backend.exists(path))) throw notFoundError(path)
    throw error
  })
}

export function createGitFs(backend: GitFsBackend): { promises: GitFsPromises } {
  const promises: GitFsPromises = {
    readFile: (path: string, options?: ReadFileOptions) =>
      withNotFound(backend, path, async () => {
        const bytes = await backend.readFile(path)
        return options?.encoding ? decoder.decode(bytes) : bytes
      }),
    writeFile: (path: string, data: Uint8Array | string) => backend.writeFile(path, toBytes(data)),
    unlink: (path: string) => withNotFound(backend, path, () => backend.unlink(path)),
    readdir: (path: string) => withNotFound(backend, path, () => backend.readdir(path)),
    mkdir: (path: string) => backend.mkdir(path),
    rmdir: (path: string) => withNotFound(backend, path, () => backend.rmdir(path)),
    stat: (path: string) => withNotFound(backend, path, async () => toGitStat(await backend.stat(path))),
    lstat: (path: string) => withNotFound(backend, path, async () => toGitStat(await backend.stat(path))),
    // isomorphic-git binds all ten fs methods up front, so these must exist
    // even though the device backend has no symlink support. Mirror git's
    // `core.symlinks=false`: store the link target as a plain file.
    readlink: (path: string) =>
      withNotFound(backend, path, async () => decoder.decode(await backend.readFile(path))),
    symlink: (target: string, path: string) => backend.writeFile(path, encoder.encode(target)),
  }
  return { promises }
}
