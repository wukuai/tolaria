import { describe, expect, it } from 'vitest'
import { classifyAddRemoteError, classifyPullError, classifyPushError } from './gitErrors'

describe('classifyPushError', () => {
  it('maps push rejection to rejected', () => {
    const result = classifyPushError({ code: 'PushRejectedError', message: 'not fast-forward' })
    expect(result).toEqual({ status: 'rejected', message: 'not fast-forward' })
  })

  it('maps HTTP 401/403 to auth_error', () => {
    expect(classifyPushError({ data: { statusCode: 401 } }).status).toBe('auth_error')
    expect(classifyPushError({ data: { statusCode: 403 } }).status).toBe('auth_error')
  })

  it('maps transport failures to network_error', () => {
    expect(classifyPushError({ code: 'HttpError', message: 'offline' }).status).toBe('network_error')
    expect(classifyPushError({ code: 'UserCanceledError' }).status).toBe('network_error')
  })

  it('falls back to error with a default message', () => {
    const result = classifyPushError('boom')
    expect(result.status).toBe('error')
    expect(result.message).toBe('boom')
  })
})

describe('classifyPullError', () => {
  it('maps merge failures to conflict', () => {
    expect(classifyPullError({ code: 'MergeNotSupportedError' }).status).toBe('conflict')
    expect(classifyPullError({ code: 'MergeConflictError' }).status).toBe('conflict')
  })

  it('returns empty file lists on conflict', () => {
    const result = classifyPullError({ code: 'MergeConflictError' })
    expect(result.updatedFiles).toEqual([])
    expect(result.conflictFiles).toEqual([])
  })

  it('falls back to error', () => {
    expect(classifyPullError({ message: 'nope' })).toEqual({
      status: 'error',
      message: 'nope',
      updatedFiles: [],
      conflictFiles: [],
    })
  })
})

describe('classifyAddRemoteError', () => {
  it('maps auth and network failures', () => {
    expect(classifyAddRemoteError({ data: { statusCode: 403 } }).status).toBe('auth_error')
    expect(classifyAddRemoteError({ code: 'HttpError' }).status).toBe('network_error')
  })

  it('falls back to error with a default message', () => {
    expect(classifyAddRemoteError({})).toEqual({
      status: 'error',
      message: 'Failed to connect remote',
    })
  })
})
