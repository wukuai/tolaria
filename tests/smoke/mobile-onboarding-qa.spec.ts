import { expect, test } from '@playwright/test'

/**
 * Mobile onboarding QA harness.
 *
 * Drives the real UI in Chromium with an Android user agent and a
 * `__TAURI_INTERNALS__` shim, so the full mobile vault-creation path runs:
 * real React flows, real isomorphic-git in the page, the production fs/http
 * adapters — with the device plugin boundary served by an in-memory fs and
 * Node-side network proxy. Commands outside that boundary fall through to the
 * app's own mock-tauri handlers.
 *
 * Not part of the smoke lane: it exists to QA phone behavior without a phone.
 */

const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36'

const VAULT_PARENT = '/mobile/Documents'
const TEMPLATE_VAULT = `${VAULT_PARENT}/Getting Started`

test.use({ userAgent: ANDROID_UA, viewport: { width: 412, height: 915 } })

test('template vault clone works end to end on the mobile path', async ({ page }) => {
  test.setTimeout(180000)
  page.on('console', (message) => {
    if (message.type() === 'error') console.log(`[page:error] ${message.text()}`)
  })
  page.on('pageerror', (error) => console.log(`[pageerror] ${error.message}`))

  await page.exposeFunction(
    'qaHttpProxy',
    async (config: { method: string; url: string; headers: [string, string][]; data: number[] | null }) => {
      const response = await fetch(config.url, {
        method: config.method,
        headers: config.headers,
        body: config.data ? Buffer.from(config.data) : undefined,
        redirect: 'follow',
      })
      const body = Buffer.from(await response.arrayBuffer())
      return {
        status: response.status,
        statusText: response.statusText,
        url: response.url,
        headers: [...response.headers.entries()],
        bodyBase64: body.toString('base64'),
      }
    },
  )

  await page.addInitScript(`{
    const files = new Map()
    const dirs = new Set(['/', '/mobile', '/mobile/Documents'])

    const parentOf = (path) => path.slice(0, path.lastIndexOf('/')) || '/'
    const normalize = (path) => path.replace(/\\/+$/, '') || '/'
    const ensureDirs = (path) => {
      let current = normalize(path)
      while (current && current !== '/') {
        dirs.add(current)
        current = parentOf(current)
      }
    }

    const fsExists = (path) => files.has(path) || dirs.has(path)

    const fsCommands = {
      'plugin:fs|exists': ({ path }) => fsExists(normalize(path)),
      'plugin:fs|mkdir': ({ path }) => { ensureDirs(path); return null },
      'plugin:fs|remove': ({ path }) => {
        const target = normalize(path)
        files.delete(target)
        dirs.delete(target)
        for (const file of [...files.keys()]) if (file.startsWith(target + '/')) files.delete(file)
        for (const dir of [...dirs]) if (dir.startsWith(target + '/')) dirs.delete(dir)
        return null
      },
      'plugin:fs|read_file': ({ path }) => {
        const data = files.get(normalize(path))
        if (!data) throw 'No such file: ' + path
        return Array.from(data)
      },
      'plugin:fs|read_dir': ({ path }) => {
        const target = normalize(path)
        if (!dirs.has(target)) throw 'No such directory: ' + path
        const names = new Set()
        for (const file of files.keys()) {
          if (parentOf(file) === target) names.add(JSON.stringify({ name: file.slice(target.length + 1), isFile: true, isDirectory: false, isSymlink: false }))
        }
        for (const dir of dirs) {
          if (dir !== target && parentOf(dir) === target) names.add(JSON.stringify({ name: dir.slice(target.length + 1), isFile: false, isDirectory: true, isSymlink: false }))
        }
        return [...names].map((entry) => JSON.parse(entry))
      },
      'plugin:fs|stat': ({ path }) => {
        const target = normalize(path)
        if (files.has(target)) {
          return { isFile: true, isDirectory: false, isSymlink: false, size: files.get(target).length, mtime: Date.now(), atime: Date.now(), birthtime: Date.now(), readonly: false }
        }
        if (dirs.has(target)) {
          return { isFile: false, isDirectory: true, isSymlink: false, size: 0, mtime: Date.now(), atime: Date.now(), birthtime: Date.now(), readonly: false }
        }
        throw 'No such path: ' + path
      },
    }

    const httpRequests = new Map()
    const httpResponses = new Map()
    let nextRid = 1

    const appCommands = {
      get_default_vault_path: () => '${TEMPLATE_VAULT}',
      check_vault_exists: ({ path }) => fsExists(normalize(path) + '/.git'),
      repair_vault: () => 'Vault repaired',
      create_empty_vault: ({ targetPath }) => { ensureDirs(targetPath); return normalize(targetPath) },
    }

    let mockModulePromise = null
    const loadMockInvoke = () => {
      mockModulePromise ??= import('/src/mock-tauri/index.ts')
      return mockModulePromise
    }

    const invoke = async (command, payload, options) => {
      if (command in fsCommands) return fsCommands[command](payload ?? {})
      if (command in appCommands) return appCommands[command](payload ?? {})

      if (command === 'plugin:fs|write_file') {
        const path = normalize(decodeURIComponent(options.headers.path))
        ensureDirs(path.slice(0, path.lastIndexOf('/')))
        files.set(path, new Uint8Array(payload))
        return null
      }
      if (command === 'plugin:http|fetch') {
        const rid = nextRid++
        httpRequests.set(rid, payload.clientConfig)
        return rid
      }
      if (command === 'plugin:http|fetch_send') {
        const config = httpRequests.get(payload.rid)
        const result = await window.qaHttpProxy({
          method: config.method,
          url: config.url,
          headers: config.headers,
          data: config.data ? Array.from(new Uint8Array(config.data)) : null,
        })
        const bytes = Uint8Array.from(atob(result.bodyBase64), (c) => c.charCodeAt(0))
        httpResponses.set(payload.rid, bytes)
        return { status: result.status, statusText: result.statusText, url: result.url, headers: result.headers, rid: payload.rid }
      }
      if (command === 'plugin:http|fetch_read_body') {
        const bytes = httpResponses.get(payload.rid) ?? new Uint8Array()
        httpResponses.delete(payload.rid)
        const withFlag = new Uint8Array(bytes.length + 1)
        withFlag.set(bytes)
        withFlag[bytes.length] = 1
        return Array.from(withFlag)
      }
      if (command.startsWith('plugin:http|')) return null

      const { mockInvoke } = await loadMockInvoke()
      return mockInvoke(command, payload ?? {})
    }

    let callbackId = 1
    window.__TAURI_INTERNALS__ = {
      invoke,
      transformCallback: (callback) => {
        const id = callbackId++
        window['_' + id] = callback
        return id
      },
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
    }
  }`)

  await page.goto('/')

  // The welcome screen must offer the template without a folder-picker option.
  const templateButton = page.getByTestId('welcome-create-vault')
  await expect(templateButton).toBeVisible({ timeout: 20000 })
  await expect(page.getByTestId('welcome-open-folder')).toHaveCount(0)
  await page.screenshot({ path: 'test-results/qa-mobile-1-welcome.png' })

  await templateButton.click()
  await page.screenshot({ path: 'test-results/qa-mobile-2-downloading.png' })

  // The clone runs real isomorphic-git in the page against the real template
  // repo, so allow generous time; success means the welcome screen goes away
  // (the app moves on to loading the vault) and no error is shown.
  await expect(page.getByTestId('welcome-error')).toHaveCount(0)
  await expect(page.getByTestId('welcome-screen')).toHaveCount(0, { timeout: 120000 })
  await page.screenshot({ path: 'test-results/qa-mobile-3-after-clone.png' })
})
