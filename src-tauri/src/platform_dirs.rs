//! Base-directory resolution that works on every platform.
//!
//! The `dirs` crate has no Android support: `config_dir`, `document_dir`, and
//! `home_dir` return `None` (or unusable paths) inside an Android app sandbox.
//! On mobile the app injects the correct base directories from Tauri's path
//! resolver at startup; desktop keeps the `dirs` behavior so existing installs
//! find their files where they always were.

use std::path::PathBuf;
use std::sync::OnceLock;

static CONFIG_DIR_OVERRIDE: OnceLock<PathBuf> = OnceLock::new();
static DOCUMENT_DIR_OVERRIDE: OnceLock<PathBuf> = OnceLock::new();

/// Inject platform base directories resolved from the Tauri app handle.
/// Later calls are ignored; the first override wins.
pub fn set_base_dir_overrides(config_dir: PathBuf, document_dir: PathBuf) {
    let _ = CONFIG_DIR_OVERRIDE.set(config_dir);
    let _ = DOCUMENT_DIR_OVERRIDE.set(document_dir);
}

/// Directory for app configuration files.
pub fn config_dir() -> Option<PathBuf> {
    CONFIG_DIR_OVERRIDE.get().cloned().or_else(dirs::config_dir)
}

/// Directory for user documents (default vault location).
pub fn document_dir() -> Option<PathBuf> {
    DOCUMENT_DIR_OVERRIDE
        .get()
        .cloned()
        .or_else(dirs::document_dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    // OnceLock state is process-wide, so a single test exercises the full
    // override lifecycle: fallback first, then injected values win.
    #[test]
    fn overrides_replace_dirs_fallback_once_set() {
        let fallback_config = config_dir();
        assert_eq!(fallback_config, dirs::config_dir());
        assert_eq!(document_dir(), dirs::document_dir());

        set_base_dir_overrides(PathBuf::from("/mobile/config"), PathBuf::from("/mobile/docs"));
        assert_eq!(config_dir(), Some(PathBuf::from("/mobile/config")));
        assert_eq!(document_dir(), Some(PathBuf::from("/mobile/docs")));

        // A second override attempt must not displace the first.
        set_base_dir_overrides(PathBuf::from("/other"), PathBuf::from("/other"));
        assert_eq!(config_dir(), Some(PathBuf::from("/mobile/config")));
        assert_eq!(document_dir(), Some(PathBuf::from("/mobile/docs")));
    }
}
