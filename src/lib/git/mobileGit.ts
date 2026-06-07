import {
  add,
  clone,
  commit,
  currentBranch,
  init,
  listRemotes,
  log,
  pull,
  push,
  remove,
  statusMatrix,
} from 'isomorphic-git'
import type { AuthCallback, FsClient, HttpClient } from 'isomorphic-git'
import type {
  GitAddRemoteResult,
  GitPullResult,
  GitPushResult,
  GitRemoteStatus,
  LastCommitInfo,
  ModifiedFile,
} from '../../types'
import { classifyAddRemoteError, classifyPullError, classifyPushError } from './gitErrors'
import { hasUncommittedChanges, rowsToModifiedFiles, type StatusRow } from './gitStatus'

/**
 * In-process git engine for mobile (Android/iOS), where no system `git` binary
 * exists. It exposes the same operations the desktop Rust git commands provide,
 * backed by isomorphic-git running against the device filesystem.
 *
 * Every operation takes an explicit {@link GitContext} so the engine stays pure
 * with respect to platform wiring: production passes a Tauri-fs-backed `fs` and
 * a web `http` client, while tests pass Node's `fs` and a fake transport.
 */
export interface GitAuthor {
  name: string
  email: string
}

export interface GitContext {
  fs: FsClient
  http: HttpClient
  dir: string
  author: GitAuthor
  onAuth?: AuthCallback
  corsProxy?: string
}

const DEFAULT_BRANCH = 'main'
const DEFAULT_REMOTE = 'origin'

export async function isGitRepo(ctx: GitContext): Promise<boolean> {
  try {
    await currentBranch({ fs: ctx.fs, dir: ctx.dir })
    return true
  } catch {
    return false
  }
}

export async function initRepo(ctx: GitContext): Promise<void> {
  await init({ fs: ctx.fs, dir: ctx.dir, defaultBranch: DEFAULT_BRANCH })
}

async function readStatusRows(ctx: GitContext): Promise<StatusRow[]> {
  const rows = await statusMatrix({ fs: ctx.fs, dir: ctx.dir })
  return rows as StatusRow[]
}

export async function getModifiedFiles(ctx: GitContext): Promise<ModifiedFile[]> {
  return rowsToModifiedFiles(await readStatusRows(ctx), ctx.dir)
}

async function stageRow(ctx: GitContext, row: StatusRow): Promise<void> {
  const [filepath, , workdir] = row
  if (workdir === 0) {
    await remove({ fs: ctx.fs, dir: ctx.dir, filepath })
  } else {
    await add({ fs: ctx.fs, dir: ctx.dir, filepath })
  }
}

/**
 * Stages every change in the working tree and commits it. Returns the new
 * commit hash, or `null` when there was nothing to commit (mirrors the desktop
 * behavior of skipping empty commits).
 */
export async function commitAll(ctx: GitContext, message: string): Promise<string | null> {
  const rows = await readStatusRows(ctx)
  if (!hasUncommittedChanges(rows)) return null
  for (const row of rows) {
    await stageRow(ctx, row)
  }
  return commit({ fs: ctx.fs, dir: ctx.dir, message, author: ctx.author })
}

export async function getLastCommitInfo(ctx: GitContext): Promise<LastCommitInfo | null> {
  try {
    const commits = await log({ fs: ctx.fs, dir: ctx.dir, depth: 1 })
    const latest = commits[0]
    if (!latest) return null
    return { shortHash: latest.oid.slice(0, 7), commitUrl: null }
  } catch {
    return null
  }
}

export async function hasRemote(ctx: GitContext): Promise<boolean> {
  const remotes = await listRemotes({ fs: ctx.fs, dir: ctx.dir })
  return remotes.length > 0
}

export async function getRemoteStatus(ctx: GitContext): Promise<GitRemoteStatus> {
  const branch = (await currentBranch({ fs: ctx.fs, dir: ctx.dir })) ?? DEFAULT_BRANCH
  return { branch, ahead: 0, behind: 0, hasRemote: await hasRemote(ctx) }
}

function ensureRemote(present: boolean): GitPushResult | null {
  return present ? null : { status: 'no_remote', message: 'No remote configured' }
}

export async function pushToRemote(ctx: GitContext): Promise<GitPushResult> {
  const missing = ensureRemote(await hasRemote(ctx))
  if (missing) return missing
  try {
    const result = await push({
      fs: ctx.fs,
      http: ctx.http,
      dir: ctx.dir,
      remote: DEFAULT_REMOTE,
      onAuth: ctx.onAuth,
      corsProxy: ctx.corsProxy,
    })
    if (result.ok) return { status: 'ok', message: 'Pushed to remote' }
    return { status: 'rejected', message: result.error ?? 'Push rejected by remote' }
  } catch (error) {
    return classifyPushError(error)
  }
}

function noRemotePull(): GitPullResult {
  return { status: 'no_remote', message: 'No remote configured', updatedFiles: [], conflictFiles: [] }
}

export async function pullFromRemote(ctx: GitContext): Promise<GitPullResult> {
  if (!(await hasRemote(ctx))) return noRemotePull()
  try {
    await pull({
      fs: ctx.fs,
      http: ctx.http,
      dir: ctx.dir,
      author: ctx.author,
      onAuth: ctx.onAuth,
      corsProxy: ctx.corsProxy,
      singleBranch: true,
    })
    return { status: 'updated', message: 'Pulled from remote', updatedFiles: [], conflictFiles: [] }
  } catch (error) {
    return classifyPullError(error)
  }
}

export async function cloneRepo(ctx: GitContext, url: string): Promise<void> {
  await clone({
    fs: ctx.fs,
    http: ctx.http,
    dir: ctx.dir,
    url,
    onAuth: ctx.onAuth,
    corsProxy: ctx.corsProxy,
    singleBranch: true,
  })
}

export async function addRemoteAndFetch(ctx: GitContext, url: string): Promise<GitAddRemoteResult> {
  try {
    if (await hasRemote(ctx)) {
      return { status: 'already_configured', message: 'Remote already configured' }
    }
    const { addRemote, fetch } = await import('isomorphic-git')
    await addRemote({ fs: ctx.fs, dir: ctx.dir, remote: DEFAULT_REMOTE, url })
    await fetch({
      fs: ctx.fs,
      http: ctx.http,
      dir: ctx.dir,
      remote: DEFAULT_REMOTE,
      onAuth: ctx.onAuth,
      corsProxy: ctx.corsProxy,
    })
    return { status: 'connected', message: 'Connected to remote' }
  } catch (error) {
    return classifyAddRemoteError(error)
  }
}
