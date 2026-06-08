import { describe, expect, it } from 'vitest'
import { hasUncommittedChanges, rowsToModifiedFiles, rowToStatus, type StatusRow } from './gitStatus'

describe('rowToStatus', () => {
  it('classifies new files as untracked or added', () => {
    expect(rowToStatus(['new.md', 0, 2, 0])).toBe('untracked')
    expect(rowToStatus(['new.md', 0, 2, 2])).toBe('added')
  })

  it('classifies deletions and modifications', () => {
    expect(rowToStatus(['gone.md', 1, 0, 1])).toBe('deleted')
    expect(rowToStatus(['edit.md', 1, 2, 1])).toBe('modified')
  })

  it('returns null for unchanged or absent files', () => {
    expect(rowToStatus(['same.md', 1, 1, 1])).toBeNull()
    expect(rowToStatus(['ghost.md', 0, 0, 0])).toBeNull()
  })
})

describe('rowsToModifiedFiles', () => {
  it('builds absolute and relative paths and drops unchanged rows', () => {
    const rows: StatusRow[] = [
      ['notes/a.md', 1, 2, 1],
      ['notes/b.md', 1, 1, 1],
      ['c.md', 0, 2, 0],
    ]
    expect(rowsToModifiedFiles(rows, '/vault/')).toEqual([
      { path: '/vault/notes/a.md', relativePath: 'notes/a.md', status: 'modified' },
      { path: '/vault/c.md', relativePath: 'c.md', status: 'untracked' },
    ])
  })

  it('handles an empty dir without a leading slash', () => {
    expect(rowsToModifiedFiles([['a.md', 0, 2, 0]], '')).toEqual([
      { path: 'a.md', relativePath: 'a.md', status: 'untracked' },
    ])
  })
})

describe('hasUncommittedChanges', () => {
  it('detects any changed row', () => {
    expect(hasUncommittedChanges([['a.md', 1, 1, 1]])).toBe(false)
    expect(hasUncommittedChanges([['a.md', 1, 1, 1], ['b.md', 1, 2, 1]])).toBe(true)
  })
})
