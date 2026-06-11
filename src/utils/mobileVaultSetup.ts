import { invoke } from '@tauri-apps/api/core'
import { runGitCommand } from '../lib/git'
import { shouldUseInProcessGit } from './platform'

/**
 * Vault creation on phones: there is no folder picker (and SAF URIs would be
 * unusable by the Rust vault commands anyway), so vaults always live in the
 * app sandbox and the template is cloned by the in-process git engine
 * instead of the desktop `git` binary.
 */

/** Mirrors GETTING_STARTED_REPO_URL in src-tauri/src/vault/getting_started.rs. */
const GETTING_STARTED_REPO_URL = 'https://github.com/refactoringhq/tolaria-getting-started.git'

const EMPTY_VAULT_NAME = 'My Vault'

export function usesMobileVaultSetup(): boolean {
  return shouldUseInProcessGit()
}

/** Sandbox path where the Getting Started vault lives on mobile. */
export function mobileTemplateVaultTarget(): Promise<string> {
  return invoke<string>('get_default_vault_path', {})
}

/** Sandbox path for a fresh empty vault, next to the default vault. */
export async function mobileEmptyVaultTarget(): Promise<string> {
  const defaultPath = await mobileTemplateVaultTarget()
  const trimmed = defaultPath.replace(/\/+$/, '')
  const parent = trimmed.slice(0, trimmed.lastIndexOf('/'))
  return `${parent}/${EMPTY_VAULT_NAME}`
}

/** Clone the template with isomorphic-git, then normalize its config files. */
export async function cloneTemplateVaultInProcess(targetPath: string): Promise<string> {
  await runGitCommand('clone_git_repo', { vaultPath: targetPath, url: GETTING_STARTED_REPO_URL })
  await invoke('repair_vault', { vaultPath: targetPath })
  return targetPath
}
