import { invoke } from '@tauri-apps/api/core'
import type { AuthCallback } from 'isomorphic-git'
import { shouldUseInProcessGit } from '../../utils/platform'
import {
  addRemoteAndFetch,
  cloneRepo,
  commitAll,
  getLastCommitInfo,
  getModifiedFiles,
  getRemoteStatus,
  initRepo,
  isGitRepo,
  pullFromRemote,
  pushToRemote,
  type GitAuthor,
  type GitContext,
} from './mobileGit'

/**
 * Platform router for git operations.
 *
 * On desktop the app shells out to the system `git` binary through Rust Tauri
 * commands. On mobile that binary does not exist, so the same command names are
 * served by the in-process isomorphic-git engine ({@link mobileGit}). Callers
 * use {@link runGitCommand} and stay unaware of which backend handled the work.
 */
export type GitCommandArgs = Record<string, unknown>

const GIT_TOKEN_STORAGE_KEY = 'tolaria.git.token'
const DEFAULT_AUTHOR: GitAuthor = { name: 'Tolaria', email: 'mobile@tolaria.app' }

export class UnsupportedGitCommandError extends Error {
  constructor(command: string) {
    super(`Git command not supported on mobile: ${command}`)
    this.name = 'UnsupportedGitCommandError'
  }
}

function readStoredGitToken(): string | null {
  try {
    return globalThis.localStorage?.getItem(GIT_TOKEN_STORAGE_KEY) ?? null
  } catch {
    return null
  }
}

export function setMobileGitToken(token: string): void {
  globalThis.localStorage?.setItem(GIT_TOKEN_STORAGE_KEY, token)
}

function createOnAuth(): AuthCallback {
  return () => {
    const token = readStoredGitToken()
    return token ? { username: token, password: '' } : {}
  }
}

function vaultDir(args: GitCommandArgs): string {
  const dir = args.vaultPath ?? args.path
  if (typeof dir !== 'string' || !dir.trim()) {
    throw new Error('A vault path is required for mobile git operations')
  }
  return dir
}

type Handler = (ctx: GitContext, args: GitCommandArgs) => Promise<unknown>

const HANDLERS: Record<string, Handler> = {
  is_git_repo: (ctx) => isGitRepo(ctx),
  init_git_repo: (ctx) => initRepo(ctx).then(() => null),
  git_commit: (ctx, args) => commitAll(ctx, String(args.message ?? '')),
  git_push: (ctx) => pushToRemote(ctx),
  git_pull: (ctx) => pullFromRemote(ctx),
  git_remote_status: (ctx) => getRemoteStatus(ctx),
  get_last_commit_info: (ctx) => getLastCommitInfo(ctx),
  get_modified_files: (ctx) => getModifiedFiles(ctx),
  clone_git_repo: (ctx, args) => cloneRepo(ctx, String(args.url ?? '')).then(() => null),
  git_add_remote: (ctx, args) => addRemoteAndFetch(ctx, String(args.url ?? '')),
  // Conflict-file listing is not yet implemented on mobile; return an empty
  // list so the desktop-oriented sync loop degrades gracefully instead of
  // throwing when isomorphic-git reports a merge conflict.
  get_conflict_files: () => Promise.resolve([]),
}

export interface MobileGitDeps {
  makeContext: (dir: string) => Promise<GitContext>
  handlers: Record<string, Handler>
}

async function buildNativeContext(dir: string): Promise<GitContext> {
  const [{ createTauriGitFs }, { createTauriGitHttp }] = await Promise.all([
    import('./tauriGitFs'),
    import('./tauriGitHttp'),
  ])
  return {
    fs: createTauriGitFs() as GitContext['fs'],
    http: createTauriGitHttp(),
    dir,
    author: DEFAULT_AUTHOR,
    onAuth: createOnAuth(),
  }
}

const defaultDeps: MobileGitDeps = { makeContext: buildNativeContext, handlers: HANDLERS }

export async function dispatchMobileGit<T>(
  command: string,
  args: GitCommandArgs,
  deps: MobileGitDeps = defaultDeps,
): Promise<T> {
  const handler = deps.handlers[command]
  if (!handler) throw new UnsupportedGitCommandError(command)
  const ctx = await deps.makeContext(vaultDir(args))
  return (await handler(ctx, args)) as T
}

export function runGitCommand<T>(command: string, args: GitCommandArgs): Promise<T> {
  if (shouldUseInProcessGit()) return dispatchMobileGit<T>(command, args)
  return invoke<T>(command, args)
}
