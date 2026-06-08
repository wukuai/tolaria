//! Serde data types and normalization for user-configured AI model providers.
//!
//! These live in their own module — separate from the desktop-only HTTP client
//! in `ai_models` — because the persisted `Settings` carry `ai_model_providers`
//! and must (de)serialize on every platform, including the mobile build that
//! omits the AI networking stack entirely (see ADR-0138).

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::sync::OnceLock;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AiModelProviderKind {
    OpenAi,
    Anthropic,
    OpenAiCompatible,
    Ollama,
    LmStudio,
    OpenRouter,
    Gemini,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AiModelApiKeyStorage {
    None,
    Env,
    LocalFile,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct AiModelCapabilities {
    pub streaming: bool,
    pub tools: bool,
    pub vision: bool,
    pub json_mode: bool,
    pub reasoning: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct AiModelDefinition {
    pub id: String,
    pub display_name: Option<String>,
    pub context_window: Option<u32>,
    pub max_output_tokens: Option<u32>,
    pub capabilities: AiModelCapabilities,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct AiModelProvider {
    pub id: String,
    pub name: String,
    pub kind: AiModelProviderKind,
    pub base_url: Option<String>,
    pub api_key_storage: Option<AiModelApiKeyStorage>,
    pub api_key_env_var: Option<String>,
    pub headers: Option<BTreeMap<String, String>>,
    pub models: Vec<AiModelDefinition>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AiModelStreamRequest {
    pub provider: AiModelProvider,
    pub model_id: String,
    pub message: String,
    pub system_prompt: Option<String>,
    pub vault_path: Option<String>,
    #[serde(default)]
    pub vault_paths: Vec<String>,
    pub api_key_override: Option<String>,
    #[serde(default)]
    pub event_name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AiModelProviderTestRequest {
    pub provider: AiModelProvider,
    pub model_id: String,
    pub api_key_override: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct AiModelProviderCatalogEntry {
    kind: AiModelProviderKind,
    runtime_base_url: Option<String>,
}

static AI_MODEL_PROVIDER_CATALOG: OnceLock<Vec<AiModelProviderCatalogEntry>> = OnceLock::new();

fn provider_catalog() -> &'static [AiModelProviderCatalogEntry] {
    AI_MODEL_PROVIDER_CATALOG
        .get_or_init(|| {
            serde_json::from_str(include_str!("../../src/shared/aiModelProviderCatalog.json"))
                .expect("bundled AI model provider catalog must be valid JSON")
        })
        .as_slice()
}

pub fn provider_default_base_url(kind: &AiModelProviderKind) -> Option<&'static str> {
    provider_catalog()
        .iter()
        .find(|entry| entry.kind == *kind)
        .and_then(|entry| entry.runtime_base_url.as_deref())
}

pub fn normalize_ai_model_providers(
    providers: Option<Vec<AiModelProvider>>,
) -> Option<Vec<AiModelProvider>> {
    let normalized = providers?
        .into_iter()
        .filter_map(normalize_ai_model_provider)
        .collect::<Vec<_>>();
    if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    }
}

fn normalize_ai_model_provider(mut provider: AiModelProvider) -> Option<AiModelProvider> {
    provider.id = provider.id.trim().to_ascii_lowercase();
    provider.name = provider.name.trim().to_string();
    provider.base_url = normalize_optional_string(provider.base_url);
    provider.api_key_env_var = normalize_optional_string(provider.api_key_env_var);
    provider.api_key_storage = normalize_api_key_storage(&provider);
    provider.models = normalized_models(provider.models);

    is_valid_provider(&provider).then_some(provider)
}

fn normalize_api_key_storage(provider: &AiModelProvider) -> Option<AiModelApiKeyStorage> {
    match provider.api_key_storage {
        Some(AiModelApiKeyStorage::LocalFile) => Some(AiModelApiKeyStorage::LocalFile),
        Some(AiModelApiKeyStorage::Env) | None if provider.api_key_env_var.is_some() => {
            Some(AiModelApiKeyStorage::Env)
        }
        _ => Some(AiModelApiKeyStorage::None),
    }
}

fn normalized_models(models: Vec<AiModelDefinition>) -> Vec<AiModelDefinition> {
    models
        .into_iter()
        .filter_map(|mut model| {
            model.id = model.id.trim().to_string();
            model.display_name = normalize_optional_string(model.display_name);
            (!model.id.is_empty()).then_some(model)
        })
        .collect()
}

fn is_valid_provider(provider: &AiModelProvider) -> bool {
    !provider.id.is_empty() && !provider.name.is_empty() && !provider.models.is_empty()
}

pub(crate) fn normalize_optional_string(value: Option<String>) -> Option<String> {
    value
        .map(|candidate| candidate.trim().to_string())
        .filter(|candidate| !candidate.is_empty())
}
