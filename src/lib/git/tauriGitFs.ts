import { exists, mkdir, readDir, readFile, remove, stat, writeFile } from '@tauri-apps/plugin-fs'
import { createGitFs, type GitFileInfo, type GitFsBackend } from './gitFs'

/**
 * Native (Android/iOS) filesystem backend for the in-process git engine, backed
 * by the Tauri filesystem plugin. This module is the only place that talks to
 * the device filesystem; everything above it works through {@link GitFsBackend}.
 *
 * It cannot run outside the native shell, so it is excluded from unit-test
 * coverage (see `vite.config.ts`). The pure bridge it delegates to — and the
 * git engine that consumes it — are covered with an in-memory backend.
 */
function toGitFileInfo(info: {
  isFile: boolean
  isDirectory: boolean
  isSymlink: boolean
  size: number
  mtime: Date | null
}): GitFileInfo {
  return {
    isFile: info.isFile,
    isDirectory: info.isDirectory,
    isSymlink: info.isSymlink,
    size: info.size,
    mtimeMs: info.mtime ? info.mtime.getTime() : null,
  }
}

function createTauriBackend(): GitFsBackend {
  return {
    readFile: (path) => readFile(path),
    writeFile: (path, data) => writeFile(path, data),
    unlink: (path) => remove(path),
    rmdir: (path) => remove(path),
    mkdir: (path) => mkdir(path, { recursive: true }),
    readdir: async (path) => (await readDir(path)).map((entry) => entry.name),
    stat: async (path) => toGitFileInfo(await stat(path)),
    exists: (path) => exists(path),
  }
}

export function createTauriGitFs() {
  return createGitFs(createTauriBackend())
}
