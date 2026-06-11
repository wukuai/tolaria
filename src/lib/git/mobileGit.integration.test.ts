import { execFile } from 'node:child_process'
import { promises as nodeFs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { GitHttpRequest, GitHttpResponse, HttpClient } from 'isomorphic-git'
import { createGitFs, type GitFsBackend } from './gitFs'
import { cloneRepo, commitAll, getLastCommitInfo, getModifiedFiles, isGitRepo, type GitContext } from './mobileGit'

/**
 * End-to-end engine tests with the REAL isomorphic-git — no mocks.
 *
 * The fs side runs the production `createGitFs` bridge over a Node backend
 * with the same shape as the device backend; the http side speaks the real
 * git smart-HTTP protocol against a local `git upload-pack`. A missing or
 * misshaped bridge method (like the readlink/symlink gap that broke template
 * cloning on Android) fails here immediately, offline, in milliseconds.
 */

const run = promisify(execFile)

const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
}

function git(args: string[], cwd: string) {
  return run('git', args, { cwd, env: GIT_ENV })
}

/** GitFsBackend over node:fs — mirrors the device backend contract. */
function createNodeBackend(): GitFsBackend {
  return {
    readFile: (path) => nodeFs.readFile(path),
    writeFile: async (path, data) => {
      await nodeFs.writeFile(path, data)
    },
    unlink: (path) => nodeFs.unlink(path),
    mkdir: async (path) => {
      await nodeFs.mkdir(path, { recursive: true })
    },
    rmdir: (path) => nodeFs.rmdir(path),
    readdir: (path) => nodeFs.readdir(path),
    stat: async (path) => {
      const info = await nodeFs.lstat(path)
      return {
        isFile: info.isFile(),
        isDirectory: info.isDirectory(),
        isSymlink: info.isSymbolicLink(),
        size: info.size,
        mtimeMs: info.mtimeMs,
      }
    },
    exists: async (path) => {
      try {
        await nodeFs.lstat(path)
        return true
      } catch {
        return false
      }
    },
  }
}

/**
 * Speaks git smart-HTTP by piping to a local `git upload-pack`, exactly what
 * a hosting server does. Lets the real isomorphic-git clone run offline.
 */
function createLocalUploadPackHttp(repoPath: string): HttpClient {
  return {
    async request(request: GitHttpRequest): Promise<GitHttpResponse> {
      const respond = (bytes: Uint8Array, contentType: string): GitHttpResponse => ({
        url: request.url,
        method: request.method ?? 'GET',
        statusCode: 200,
        statusMessage: 'OK',
        headers: { 'content-type': contentType },
        body: (async function* () {
          yield bytes
        })(),
      })

      if (request.url.includes('/info/refs')) {
        const { stdout } = await run(
          'git',
          ['upload-pack', '--stateless-rpc', '--advertise-refs', repoPath],
          { env: GIT_ENV, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 },
        )
        const header = new TextEncoder().encode('001e# service=git-upload-pack\n0000')
        const merged = new Uint8Array(header.length + stdout.length)
        merged.set(header)
        merged.set(stdout, header.length)
        return respond(merged, 'application/x-git-upload-pack-advertisement')
      }

      const chunks: Uint8Array[] = []
      for await (const chunk of request.body ?? []) chunks.push(chunk)
      const requestBody = Buffer.concat(chunks)

      const child = execFile(
        'git',
        ['upload-pack', '--stateless-rpc', repoPath],
        { env: GIT_ENV, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 },
      )
      child.stdin?.end(requestBody)
      const stdout = await new Promise<Buffer>((resolve, reject) => {
        const out: Buffer[] = []
        child.stdout?.on('data', (data: Buffer) => out.push(data))
        child.on('error', reject)
        child.on('close', () => resolve(Buffer.concat(out)))
      })
      return respond(stdout, 'application/x-git-upload-pack-result')
    },
  }
}

let workDir: string

function makeContext(dir: string, repoPath: string): GitContext {
  return {
    fs: createGitFs(createNodeBackend()) as unknown as GitContext['fs'],
    http: createLocalUploadPackHttp(repoPath),
    dir,
    author: { name: 'Tolaria', email: 'mobile@tolaria.app' },
  }
}

beforeEach(async () => {
  workDir = await nodeFs.mkdtemp(join(tmpdir(), 'mobile-git-'))
})

afterEach(async () => {
  await nodeFs.rm(workDir, { recursive: true, force: true })
})

async function createSourceRepo(): Promise<string> {
  const source = join(workDir, 'source')
  await nodeFs.mkdir(source)
  await git(['init', '-q', '-b', 'main'], source)
  await nodeFs.writeFile(join(source, 'welcome.md'), '# Welcome\n')
  await nodeFs.mkdir(join(source, 'views'))
  await nodeFs.writeFile(join(source, 'views', 'projects.yml'), 'name: projects\n')
  await git(['add', '.'], source)
  await git(['commit', '-q', '-m', 'template'], source)
  return source
}

describe('mobile git engine against real isomorphic-git', () => {
  it('clones a repository through the production fs bridge', async () => {
    const source = await createSourceRepo()
    const dest = join(workDir, 'dest')
    const ctx = makeContext(dest, source)

    await cloneRepo(ctx, 'http://local/template.git')

    expect(String(await nodeFs.readFile(join(dest, 'welcome.md')))).toBe('# Welcome\n')
    expect(String(await nodeFs.readFile(join(dest, 'views', 'projects.yml')))).toBe('name: projects\n')
    expect(await isGitRepo(ctx)).toBe(true)
  }, 30000)

  it('commits new work on top of a clone and reports a clean tree', async () => {
    const source = await createSourceRepo()
    const dest = join(workDir, 'dest')
    const ctx = makeContext(dest, source)
    await cloneRepo(ctx, 'http://local/template.git')

    await nodeFs.writeFile(join(dest, 'note.md'), '# A note\n')
    expect(await getModifiedFiles(ctx)).toEqual([
      expect.objectContaining({ relativePath: 'note.md' }),
    ])

    const commitSha = await commitAll(ctx, 'add note')
    expect(commitSha).toMatch(/^[0-9a-f]{40}$/)
    expect(await getModifiedFiles(ctx)).toEqual([])

    const last = await getLastCommitInfo(ctx)
    expect(last?.shortHash).toBe(commitSha?.slice(0, 7))
  }, 30000)
})
