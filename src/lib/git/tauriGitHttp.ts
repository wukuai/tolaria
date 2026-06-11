import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import type { GitHttpRequest, GitHttpResponse, HttpClient } from 'isomorphic-git'

/**
 * isomorphic-git HTTP client backed by the Tauri http plugin.
 *
 * Git smart-HTTP endpoints (GitHub included) send no CORS headers, so
 * WebView `fetch` cannot reach them from the app origin on mobile. The
 * plugin performs the request from the Rust side, where CORS does not apply.
 */

async function collectRequestBody(
  body: GitHttpRequest['body'],
): Promise<ArrayBuffer | undefined> {
  if (!body) return undefined

  const chunks: Uint8Array[] = []
  let total = 0
  for await (const chunk of body) {
    chunks.push(chunk)
    total += chunk.byteLength
  }

  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return merged.buffer
}

async function* singleChunk(bytes: Uint8Array): AsyncIterableIterator<Uint8Array> {
  yield bytes
}

function headerRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {}
  headers.forEach((value, key) => {
    record[key] = value
  })
  return record
}

export function createTauriGitHttp(): HttpClient {
  return {
    async request(request: GitHttpRequest): Promise<GitHttpResponse> {
      const body = await collectRequestBody(request.body)
      const response = await tauriFetch(request.url, {
        method: request.method ?? 'GET',
        headers: request.headers,
        ...(body ? { body } : {}),
      })

      const responseBytes = new Uint8Array(await response.arrayBuffer())
      return {
        url: response.url || request.url,
        method: request.method ?? 'GET',
        statusCode: response.status,
        statusMessage: response.statusText,
        headers: headerRecord(response.headers),
        body: singleChunk(responseBytes),
      }
    },
  }
}
