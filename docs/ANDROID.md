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

These are gated behind `#[cfg(desktop)]` in `src-tauri/src/lib.rs` and excluded
from the mobile Cargo dependency graph:

- the native menu bar, custom window chrome, and window-state persistence
- the auto-updater and single-instance handling
- the MCP server bridge and the CLI AI agents (Claude/Codex/Gemini/etc.), which
  rely on spawning local processes

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

## Known limitations / remaining work

- isomorphic-git's merge support is limited; merge conflicts are surfaced but not
  yet resolvable from the mobile UI.
- The remaining `#[cfg(desktop)]`-only Rust modules (`app_updater`, the MCP and
  CLI-agent commands) still need to be gated out of the mobile build so it links
  cleanly — see ADR-0138 "Remaining work".
- The build has not yet been validated end-to-end on a device; it requires the
  Android SDK + NDK, which are not present in CI containers.
