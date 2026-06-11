import { beforeEach, describe, expect, it, vi } from 'vitest'

const pluginFetch = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: pluginFetch }))

import { createTauriGitHttp } from './tauriGitHttp'

function mockResponse(bodyBytes: Uint8Array, init?: Partial<{ status: number; statusText: string; headers: Record<string, string> }>) {
  return {
    status: init?.status ?? 200,
    statusText: init?.statusText ?? 'OK',
    url: 'https://example.com/repo.git/info/refs',
    headers: new Headers(init?.headers ?? { 'content-type': 'application/x-git-upload-pack-advertisement' }),
    arrayBuffer: () => Promise.resolve(bodyBytes.buffer.slice(bodyBytes.byteOffset, bodyBytes.byteOffset + bodyBytes.byteLength)),
  }
}

beforeEach(() => {
  pluginFetch.mockReset()
})

describe('createTauriGitHttp', () => {
  it('performs a GET and exposes the response in isomorphic-git shape', async () => {
    const payload = new Uint8Array([1, 2, 3])
    pluginFetch.mockResolvedValue(mockResponse(payload))

    const http = createTauriGitHttp()
    const response = await http.request({
      url: 'https://example.com/repo.git/info/refs?service=git-upload-pack',
      method: 'GET',
      headers: { accept: '*/*' },
    })

    expect(pluginFetch).toHaveBeenCalledWith(
      'https://example.com/repo.git/info/refs?service=git-upload-pack',
      expect.objectContaining({ method: 'GET', headers: { accept: '*/*' } }),
    )
    expect(response.statusCode).toBe(200)
    expect(response.statusMessage).toBe('OK')
    expect(response.headers?.['content-type']).toBe('application/x-git-upload-pack-advertisement')

    const chunks: Uint8Array[] = []
    for await (const chunk of response.body ?? []) chunks.push(chunk)
    expect(chunks).toEqual([payload])
  })

  it('concatenates an async-iterable request body into one POST payload', async () => {
    pluginFetch.mockResolvedValue(mockResponse(new Uint8Array()))

    async function* body() {
      yield new Uint8Array([10, 11])
      yield new Uint8Array([12])
    }

    const http = createTauriGitHttp()
    await http.request({
      url: 'https://example.com/repo.git/git-upload-pack',
      method: 'POST',
      body: body(),
    })

    const sent = pluginFetch.mock.calls[0][1].body as ArrayBuffer
    expect(Array.from(new Uint8Array(sent))).toEqual([10, 11, 12])
  })
})
