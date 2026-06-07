import type { ModifiedFile } from '../../types'

/**
 * isomorphic-git's `statusMatrix` returns one row per path shaped as
 * `[filepath, headStatus, workdirStatus, stageStatus]` where each status is a
 * small integer:
 *   - head:    0 = absent from last commit, 1 = present
 *   - workdir: 0 = absent on disk, 1 = identical to head, 2 = changed
 *   - stage:   0 = absent from index, 1+ = staged
 *
 * These helpers turn that matrix into the same shapes the desktop git commands
 * expose so the rest of the app stays platform-agnostic.
 */
export type StatusRow = [string, number, number, number]

const HEAD_ABSENT = 0
const WORKDIR_ABSENT = 0
const WORKDIR_UNCHANGED = 1

function joinRepoPath(dir: string, filepath: string): string {
  const base = dir.replace(/\/+$/, '')
  return base ? `${base}/${filepath}` : filepath
}

export function rowToStatus(row: StatusRow): ModifiedFile['status'] | null {
  const [, head, workdir, stage] = row
  if (head === HEAD_ABSENT) {
    if (workdir === WORKDIR_ABSENT) return null
    return stage === 0 ? 'untracked' : 'added'
  }
  if (workdir === WORKDIR_ABSENT) return 'deleted'
  if (workdir === WORKDIR_UNCHANGED) return null
  return 'modified'
}

export function rowsToModifiedFiles(rows: StatusRow[], dir: string): ModifiedFile[] {
  const files: ModifiedFile[] = []
  for (const row of rows) {
    const status = rowToStatus(row)
    if (!status) continue
    const relativePath = row[0]
    files.push({ path: joinRepoPath(dir, relativePath), relativePath, status })
  }
  return files
}

export function hasUncommittedChanges(rows: StatusRow[]): boolean {
  return rows.some((row) => rowToStatus(row) !== null)
}
