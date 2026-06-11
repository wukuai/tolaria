# Tolaria on Android

Tolaria's Android build reuses the same React frontend and Rust vault backend as
the desktop app, running on the Tauri v2 mobile target. This guide covers the
prerequisites, the build steps, and the parts of the app that behave differently
on a phone.

See [ADR-0138](./adr/0138-android-port-and-in-process-git-sync.md) for the
architecture and the rationale behind the decisions below, and
[ADR-0005](./adr/0005-tauri-ios-for-ipad.md) for the original mobile target.

## What works on mobile

- **View & edit notes** — vault scanning, the note list, and the editor all run
  through the existing platform-neutral vault commands. No git binary required.
- **Git sync** — `commit`, `pull`, `push`, `clone`, and remote status run
  **in-process** via isomorphic-git (`src/lib/git/`), because Android has no
  system `git` executable. The command surface and result shapes match the
  desktop Rust commands, so the sync UI is shared.

## What is desktop-only (skipped on mobile)

These are gated behind `#[cfg(desktop)]` (with `#[cfg(mobile)]` command stubs
where needed):

- the native menu bar, custom window chrome, and window-state persistence
- the auto-updater and single-instance handling
- the MCP server bridge and the CLI AI agents (Claude/Codex/Gemini/etc.), which
  rely on spawning local processes

Whether the AI model client, updater, and crash reporting ship on mobile is an
open product decision (see ADR-0138). Their networking pulls in native-crypto
crates that require the NDK to cross-compile.

## Prerequisites

| Tool | Notes |
|---|---|
| Rust | with the Android targets: `rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android` |
| Android SDK | install via Android Studio or the command-line tools |
| Android NDK | required to cross-compile the Rust backend |
| JDK 17+ | for the Gradle build |
| `pnpm` | frontend dependencies and Vite build |

Export the SDK/NDK locations so the Tauri CLI can find them:

```bash
export ANDROID_HOME="$HOME/Android/Sdk"
export NDK_HOME="$ANDROID_HOME/ndk/<version>"
```

## First-time setup

```bash
pnpm install
# Generate the Gradle project under src-tauri/gen/android (one time):
pnpm tauri android init
```

`tauri android init` scaffolds `src-tauri/gen/android` from
`src-tauri/tauri.conf.json` (the `bundle.android` section sets `minSdkVersion`).
That generated directory is the Android equivalent of the existing
`src-tauri/gen/apple` iOS project.

## Develop & build

```bash
# Run on a connected device or emulator with live reload:
pnpm tauri android dev

# Produce an APK / AAB:
pnpm tauri android build
```

## Git authentication on mobile

Desktop Tolaria delegates auth to the system git credential helpers
(ADR-0056), which do not exist on Android. Instead, the in-process engine
authenticates HTTPS remotes with a **Personal Access Token** supplied through
`setMobileGitToken(token)` (`src/lib/git/index.ts`), which the engine passes to
isomorphic-git's `onAuth` callback. A mobile token-entry screen is the main
remaining UI piece before sync is end-to-end usable on a phone.

## Build notes (pitfalls already solved)

- **No OpenSSL on Android.** `sentry` must use its `rustls` transport
  (`default-features = false` in `src-tauri/Cargo.toml`); the default
  `native-tls` transport tries to link system OpenSSL, which does not exist in
  the Android sysroot and fails the cross-compile.
- **Plugin version pairing.** The Tauri CLI refuses to build when a Rust plugin
  crate and its npm package are on different minor versions (e.g.
  `tauri-plugin-fs` vs `@tauri-apps/plugin-fs`). Fix with
  `cargo update -p tauri-plugin-fs` after bumping the npm side.
- **Mobile fs plugin.** `tauri-plugin-fs` is a mobile-only Rust dependency,
  registered in `setup_mobile_plugins` (`src-tauri/src/lib.rs`) and scoped in
  `src-tauri/capabilities/mobile.json` to `$APPDATA` and `$DOCUMENT` so the
  in-process git engine can reach the vault.

## Known limitations / remaining work

- isomorphic-git's merge support is limited; merge conflicts are surfaced but not
  yet resolvable from the mobile UI.
- Building the Rust backend for Android requires the **Android NDK** (just as the
  iOS target requires Xcode): the desktop feature set's native-crypto
  dependencies (`reqwest`→`ring`, `sentry`) compile for Android only with the
  NDK's clang/sysroot. The mobile *product* surface needs no Rust-side HTTP (git
  runs in the WebView), but the shared crate graph still must compile.
- The APK has been built in CI-like containers (SDK 34 + NDK r27); on-device /
  emulator QA is still outstanding.
