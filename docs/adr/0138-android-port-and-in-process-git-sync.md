---
type: ADR
id: "0138"
title: "Android port via Tauri mobile with in-process git sync"
status: active
date: 2026-06-07
supersedes: ""
---

## Context

Tolaria runs on macOS, Windows, and Linux via Tauri v2, and ADR-0005 already
established the Tauri mobile target for an iPad/iOS prototype. The next goal is a
usable **Android** build: open a vault, view and edit notes, and **sync notes
over git** from an Android phone.

The React frontend and the vault file model are already platform-neutral — the
vault commands read and write Markdown files through a filesystem the WebView
can reach, with no desktop-only assumptions. The blocking gap is git.

Tolaria's entire git stack (ADR-0034, ADR-0056) shells out to the **system
`git` binary** (`std::process::Command`). Android has no `git` executable and no
general process-spawning for the app, so `commit`, `pull`, and `push` cannot
work the way they do on desktop. ADR-0005 already flagged this and recommended
`isomorphic-git` (a pure-JS git implementation that runs in the WebView) as the
production path for mobile.

The desktop build also links several plugins that have no Android/iOS
implementation (`single-instance`, `prevent-default`) or that are only wired up
behind `#[cfg(desktop)]` (`updater`, `process`). They must leave the mobile
dependency graph for the app to link.

## Decision

**Ship the Android build on the existing Tauri v2 mobile target, reusing the
React frontend and the Rust vault backend unchanged, and serve git on mobile
from an in-process `isomorphic-git` engine instead of the system `git` binary.**

Concretely:

1. **Platform routing for git.** A new frontend module, `src/lib/git/`, exposes
   `runGitCommand(command, args)`. On desktop it forwards to the existing Rust
   git Tauri commands (`invoke`). On mobile (`shouldUseInProcessGit()` — Tauri +
   Android/iOS user agent) it dispatches the **same command names** to an
   in-process engine built on `isomorphic-git`. Callers stay platform-agnostic.

2. **In-process git engine (`mobileGit.ts`).** Implements the operations the
   sync loop needs — `is_git_repo`, `init_git_repo`, `git_commit` (stage-all +
   commit, skipping empty commits), `get_modified_files`, `get_last_commit_info`,
   `git_remote_status`, `git_pull`, `git_push`, `clone_git_repo`,
   `git_add_remote`. Error shapes are mapped to the **same result enums** the
   Rust commands return (`GitPushResult`, `GitPullResult`, …) via pure
   classifiers in `gitErrors.ts`, so the rest of the app treats mobile and
   desktop sync outcomes identically.

3. **Real-filesystem backing.** isomorphic-git runs against the *actual* vault
   files (the same files the editor reads/writes), not a separate IndexedDB
   store, so history and working tree stay consistent. `gitFs.ts` adapts a
   minimal device-filesystem backend to the isomorphic-git filesystem client and
   normalizes "missing path" failures to `ENOENT`. `tauriGitFs.ts` provides the
   native backend over `@tauri-apps/plugin-fs`.

4. **Auth.** HTTPS remotes authenticate through an `onAuth` callback backed by a
   user-provided token (Personal Access Token). System-git credential helpers
   (ADR-0056) do not exist on mobile, so the token is the mobile equivalent of
   "your existing git auth".

5. **Settings types decoupled from AI networking.** The serde types and
   normalization for `ai_model_providers` live in `ai_model_types` (compiled on
   every platform), separate from the desktop HTTP client in `ai_models`. This
   lets the persisted `Settings` (de)serialize on mobile without pulling in the
   AI model networking stack.

## Options considered

- **Pure-JS git in the WebView (`isomorphic-git`) — chosen.** No native git, no
  NDK-side git library, reuses the entire React app, fully unit-testable against
  Node's `fs`. Downsides: isomorphic-git's 3-way merge is limited (conflicts are
  surfaced, not auto-resolved on mobile yet), and large repos are slower than
  native git.
- **Bundle a Rust git library (`gix`/`git2`) compiled for Android.** Keeps git in
  Rust, but `git2`/libgit2 cross-compilation for Android with TLS is heavy, and
  `gix` push support was immature; both still need the mobile fs/credential
  story. Higher build risk for no product gain over isomorphic-git.
- **External sync (Working Copy / Files provider / cloud drive).** No history or
  in-app control; pushes the problem onto the user. Rejected (matches ADR-0005).

## Consequences

- View/edit on Android work through the existing vault commands with no frontend
  changes; the net-new surface is the git layer and platform detection.
- Desktop behavior is unchanged: `runGitCommand` is a transparent pass-through to
  `invoke` off-mobile, and the desktop dependency graph keeps every plugin.
- The native filesystem backend (`tauriGitFs.ts`) can only run in the device
  shell, so it is validated by on-device QA; the pure bridge it wraps and the git
  engine are covered by unit tests against Node's `fs` and a mocked transport.
- **Build toolchain.** Cross-compiling the Rust backend for Android requires the
  **Android NDK** — the same way the iOS target requires the Xcode toolchain.
  The native-crypto dependencies pulled in by the desktop feature set
  (`reqwest`→`ring`, `sentry`, the updater) compile for Android only with the
  NDK's clang/sysroot; there is no pure-Rust escape hatch for them. The
  in-process git engine deliberately needs **no** Rust-side HTTP (it runs in the
  WebView), so the mobile *product* surface does not depend on these, but a full
  `cargo build`/APK still needs the NDK to compile the shared crate graph.
- **Remaining work before a shippable APK** (tracked): obtain the Android SDK +
  NDK and add the Rust Android targets; run `pnpm tauri android init` to generate
  `gen/android`; register the Tauri fs plugin and scope the vault directory;
  build a mobile-friendly token entry UI; decide whether AI/updater/telemetry
  ship on mobile (and, if not, gate them behind `#[cfg(mobile)]` command stubs as
  the existing iOS scaffolding already begins to do); and validate on a
  device/emulator.
- Tauri v2 mobile remains pre-1.0 for some APIs; instability there is the main
  external risk.
