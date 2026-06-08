import type { GitAddRemoteResult, GitPullResult, GitPushResult } from '../../types'

/**
 * Maps isomorphic-git error shapes onto the same result enums the desktop Rust
 * git commands return, so the rest of the app can treat mobile and desktop sync
 * outcomes identically.
 *
 * isomorphic-git attaches a stable `code` string to every thrown error and, for
 * transport failures, an HTTP `statusCode` under `data`. We classify on those
 * rather than on human-readable messages so the mapping stays robust.
 */

interface GitErrorLike {
  code?: string
  message?: string
  data?: { statusCode?: number }
}

function asGitError(error: unknown): GitErrorLike {
  if (error && typeof error === 'object') return error as GitErrorLike
  return { message: String(error) }
}

function errorMessage(error: GitErrorLike, fallback: string): string {
  return error.message?.trim() || fallback
}

function isAuthFailure(error: GitErrorLike): boolean {
  const status = error.data?.statusCode
  if (status === 401 || status === 403) return true
  return error.code === 'UnknownTransportError' && /auth/i.test(error.message ?? '')
}

function isNetworkFailure(error: GitErrorLike): boolean {
  return (
    error.code === 'HttpError' ||
    error.code === 'UnknownTransportError' ||
    error.code === 'UserCanceledError'
  )
}

export function classifyPushError(error: unknown): GitPushResult {
  const gitError = asGitError(error)
  if (gitError.code === 'PushRejectedError') {
    return { status: 'rejected', message: errorMessage(gitError, 'Push rejected by remote') }
  }
  if (isAuthFailure(gitError)) {
    return { status: 'auth_error', message: errorMessage(gitError, 'Authentication failed') }
  }
  if (isNetworkFailure(gitError)) {
    return { status: 'network_error', message: errorMessage(gitError, 'Network error during push') }
  }
  return { status: 'error', message: errorMessage(gitError, 'Push failed') }
}

export function classifyPullError(error: unknown): GitPullResult {
  const gitError = asGitError(error)
  if (gitError.code === 'MergeNotSupportedError' || gitError.code === 'MergeConflictError') {
    return {
      status: 'conflict',
      message: errorMessage(gitError, 'Merge conflict — resolve manually'),
      updatedFiles: [],
      conflictFiles: [],
    }
  }
  return {
    status: 'error',
    message: errorMessage(gitError, 'Pull failed'),
    updatedFiles: [],
    conflictFiles: [],
  }
}

export function classifyAddRemoteError(error: unknown): GitAddRemoteResult {
  const gitError = asGitError(error)
  if (isAuthFailure(gitError)) {
    return { status: 'auth_error', message: errorMessage(gitError, 'Authentication failed') }
  }
  if (isNetworkFailure(gitError)) {
    return { status: 'network_error', message: errorMessage(gitError, 'Network error') }
  }
  return { status: 'error', message: errorMessage(gitError, 'Failed to connect remote') }
}
