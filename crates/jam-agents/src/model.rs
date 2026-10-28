use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum RuntimeKind {
    #[default]
    Acp,
    Terminal,
    Api,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Env {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SecretKey {
    pub key: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SecretView {
    pub key: String,
    pub label: String,
    pub is_set: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentProfileView {
    pub id: String,
    pub label: String,
    pub kind: RuntimeKind,
    pub preset: Option<String>,
    pub agent_name: String,
    pub command: Option<String>,
    pub args: Vec<String>,
    pub base_url: Option<String>,
    pub model: Option<String>,
    pub effort: Option<String>,
    pub effort_style: EffortStyle,
    pub env: Vec<Env>,
    pub hidden: bool,
    pub secret_keys: Vec<SecretView>,
    pub available: bool,
    pub unavailable_reason: Option<String>,
    pub built_in: bool,
    pub extra_mcp_servers: Vec<crate::McpEntry>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentProfileInput {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub label: String,
    pub kind: RuntimeKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preset: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub args: Option<Vec<String>>,
    #[serde(
        default,
        deserialize_with = "nullable_patch",
        skip_serializing_if = "Option::is_none"
    )]
    #[specta(type = Option<Option<String>>)]
    pub base_url: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "nullable_patch",
        skip_serializing_if = "Option::is_none"
    )]
    #[specta(type = Option<Option<String>>)]
    pub model: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "nullable_patch",
        skip_serializing_if = "Option::is_none"
    )]
    #[specta(type = Option<Option<String>>)]
    pub effort: Option<Option<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effort_style: Option<EffortStyle>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub env: Option<Vec<Env>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hidden: Option<bool>,
    /// Optional declarations for custom credentials, never credential values.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub secret_keys: Option<Vec<SecretKey>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extra_mcp_servers: Option<Vec<crate::McpEntry>>,
}
fn nullable_patch<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> std::result::Result<Option<Option<String>>, D::Error> {
    Option::<String>::deserialize(deserializer).map(Some)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum SessionStatus {
    Starting,
    Ready,
    Running,
    AwaitingPermission,
    Stopped,
    Failed,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    pub images: bool,
    pub audio: bool,
    pub embedded_context: bool,
    pub config_options: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionView {
    pub id: String,
    pub profile_id: String,
    pub project_id: String,
    pub kind: RuntimeKind,
    pub title: String,
    pub status: SessionStatus,
    pub cwd: String,
    pub created_at: String,
    pub capabilities: Capabilities,
    pub model: Option<String>,
    pub effort: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum PromptPart {
    Attachment {
        #[serde(rename = "attachmentId")]
        attachment_id: String,
    },
    Text {
        text: String,
    },
    BoardRef {
        uri: String,
        label: String,
        text: String,
    },
    Image {
        #[serde(rename = "mimeType")]
        mime_type: String,
        data: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PlanEntry {
    pub content: String,
    pub status: PlanStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub priority: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum PlanStatus {
    Pending,
    InProgress,
    Completed,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PermissionOption {
    pub option_id: String,
    pub name: String,
    pub kind: PermissionKind,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum PermissionKind {
    AllowOnce,
    AllowAlways,
    RejectOnce,
    RejectAlways,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct AvailableCommand {
    pub name: String,
    pub description: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ConfigValue {
    pub value: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ConfigOption {
    pub id: String,
    pub name: String,
    pub value: String,
    pub values: Vec<ConfigValue>,
    pub category: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum AuthState {
    Ok,
    Required,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum AgentErrorCode {
    UsageLimit,
    RateLimited,
    Overloaded,
    Auth,
    ContextTooLong,
    Network,
    Provider,
    Agent,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum AgentEventKind {
    LaunchStep {
        step: String,
        state: LaunchStepState,
        message: String,
        started_at: String,
        ended_at: Option<String>,
    },
    LaunchLog {
        message: String,
    },
    Status {
        status: SessionStatus,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        message: Option<String>,
    },
    UserMessage {
        message_id: String,
        content: Vec<PromptPart>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        context_preamble: Option<String>,
    },
    AgentMessageDelta {
        message_id: String,
        text: String,
    },
    AgentThoughtDelta {
        message_id: String,
        text: String,
    },
    ToolCall {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        tool_name: Option<String>,
        tool_call_id: String,
        title: String,
        tool_kind: String,
        status: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[specta(type = Option<jam_core::JsonPayload>)]
        input: Option<serde_json::Value>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        content: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        locations: Option<Vec<String>>,
    },
    ToolCallUpdate {
        tool_call_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        title: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        status: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        content: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[specta(type = Option<jam_core::JsonPayload>)]
        output: Option<serde_json::Value>,
    },
    Plan {
        entries: Vec<PlanEntry>,
    },
    PermissionRequest {
        request_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        tool_call_id: Option<String>,
        title: String,
        options: Vec<PermissionOption>,
    },
    PermissionResolved {
        request_id: String,
        option_id: Option<String>,
    },
    AvailableCommands {
        commands: Vec<AvailableCommand>,
    },
    ConfigOptions {
        options: Vec<ConfigOption>,
    },
    Auth {
        state: AuthState,
        label: String,
    },
    TurnEnd {
        stop_reason: String,
    },
    Retrying {
        attempt: u32,
        max_attempts: u32,
        delay_ms: u64,
        code: AgentErrorCode,
    },
    Error {
        #[serde(default)]
        code: Option<AgentErrorCode>,
        #[serde(default)]
        retryable: bool,
        #[serde(default)]
        retry_after_ms: Option<u64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        resets_at: Option<String>,
        message: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        detail: Option<String>,
    },
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentDockEvent {
    pub session_id: String,
    pub seq: u64,
    pub at: String,
    #[serde(flatten)]
    pub event: AgentEventKind,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentTerminalOutput {
    pub session_id: String,
    pub data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct StartAgentSessionInput {
    pub profile_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_config: Option<UserConfigChoice>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effort: Option<String>,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum UserConfigChoice {
    Include,
    Exclude,
}
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum UserConfigDefault {
    #[default]
    Ask,
    Include,
    Exclude,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentLaunchOptions {
    pub user_config_default: UserConfigDefault,
    pub exclude_supported: bool,
    pub exclude_description: String,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum LaunchStepState {
    Running,
    Ok,
    Failed,
    Skipped,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LaunchStep {
    pub step: String,
    pub state: LaunchStepState,
    pub message: String,
    pub started_at: String,
    pub ended_at: Option<String>,
}
impl AgentEventKind {
    pub fn launch_step(&self) -> Option<LaunchStep> {
        match self {
            Self::LaunchStep {
                step,
                state,
                message,
                started_at,
                ended_at,
            } => Some(LaunchStep {
                step: step.clone(),
                state: *state,
                message: message.clone(),
                started_at: started_at.clone(),
                ended_at: ended_at.clone(),
            }),
            _ => None,
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SendAgentPromptInput {
    pub session_id: String,
    pub content: Vec<PromptPart>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ResolveAgentPermissionInput {
    pub session_id: String,
    pub request_id: String,
    pub option_id: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SetAgentConfigOptionInput {
    pub session_id: String,
    pub option_id: String,
    pub value: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TerminalWriteInput {
    pub session_id: String,
    pub data: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TerminalResizeInput {
    pub session_id: String,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum EffortStyle {
    Openrouter,
    Zai,
    Openai,
    #[default]
    None,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_length: Option<u64>,
    pub input_image: bool,
    pub reasoning: bool,
    pub tools: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt_price_per_m: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completion_price_per_m: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum CatalogSource {
    Provider,
    Static,
    Profile,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ModelCatalog {
    pub models: Vec<ModelInfo>,
    pub source: CatalogSource,
    pub fetched_at: Option<String>,
    pub error: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentModelCatalogInput {
    pub profile_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub refresh: Option<bool>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(
    tag = "kind",
    rename_all = "lowercase",
    rename_all_fields = "camelCase"
)]
pub enum AttachmentSource {
    Path {
        path: String,
    },
    Bytes {
        name: String,
        mime_type: String,
        data: String,
    },
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentView {
    pub id: String,
    pub name: String,
    pub mime_type: String,
    pub size: u64,
    pub path: String,
    pub is_image: bool,
    pub thumbnail: Option<String>,
    pub preview_url: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AddAgentAttachmentInput {
    pub session_id: String,
    pub source: AttachmentSource,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RemoveAgentAttachmentInput {
    pub session_id: String,
    pub attachment_id: String,
}
