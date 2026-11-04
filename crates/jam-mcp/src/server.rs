use jam_core::{CreateTask, Member, Store, TaskFilter, UpdateTask};
use rmcp::{ErrorData, RoleServer, ServerHandler, model::*, service::RequestContext};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
use std::sync::{Arc, Mutex, OnceLock};
use tokio::sync::OnceCell;

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RecentCall {
    #[serde(default)]
    pub project_id: Option<String>,
    pub at: String,
    pub error: Option<String>,
    pub agent: String,
    pub tool: String,
    pub ok: bool,
}
pub type RecentCalls = Arc<Mutex<std::collections::VecDeque<RecentCall>>>;
fn raw_client(ctx: &RequestContext<RoleServer>) -> String {
    let info = ctx
        .peer
        .peer_info()
        .map(|i| serde_json::to_value(&i.client_info).unwrap_or(Value::Null))
        .or_else(|| {
            ctx.meta
                .client_info()
                .and_then(|i| serde_json::to_value(i).ok())
        })
        .unwrap_or(Value::Null);
    format!(
        "{}/{}",
        info["name"].as_str().unwrap_or("Agent"),
        info["version"].as_str().unwrap_or("")
    )
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SessionContextInput {
    /// Include the connection's member identity. Defaults to false for older clients.
    #[serde(default)]
    include_actor: bool,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct SessionContext {
    server_version: String,
    schema_version: i64,
    capabilities: Vec<String>,
    project_id: String,
    key_prefix: String,
    project_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    actor: Option<jam_core::MemberRef>,
    /// Verified folder anchor; legacy stores can return an unverified hint. Never a filesystem grant.
    project_folder: Option<String>,
    project_instance_id: String,
    database_generation: String,
    board_revision: i64,
    repository_root: Option<String>,
    working_directory: Option<String>,
    folder_rules: std::collections::BTreeMap<String, String>,
    manifest_revision: Option<String>,
    file_capabilities: jam_core::FileCapabilities,
    binding: String,
    can_switch_project: bool,
    /// Project-filtered global activity high-water; capture before fresh baseline reads.
    #[schemars(range(min = 0))]
    latest_activity_cursor: i64,
}

#[derive(Clone)]
pub struct JamServer {
    store: Arc<Store>,
    session_store: Arc<OnceCell<ProjectBinding>>,
    session_identity: Arc<OnceLock<(String, String)>>,
    session_client: Arc<OnceLock<String>>,
    project_hint: Option<String>,
    agent_name: Option<String>,
    allow_brain_start: bool,
    recent: RecentCalls,
    report_stdio: bool,
    project_manager: Option<Arc<jam_core::ProjectManager>>,
}
struct ProjectBinding {
    store: Arc<Store>,
    selector: Option<String>,
    folder: Option<std::path::PathBuf>,
    generation: String,
    _lease: jam_core::ProjectLease,
}
impl JamServer {
    pub fn new(store: Arc<Store>, agent_name: Option<String>, recent: RecentCalls) -> Self {
        Self {
            store,
            session_store: Arc::new(OnceCell::new()),
            session_identity: Arc::new(OnceLock::new()),
            session_client: Arc::new(OnceLock::new()),
            project_hint: None,
            agent_name,
            allow_brain_start: false,
            recent,
            report_stdio: false,
            project_manager: None,
        }
    }
    /// Enable delegated Start for a trusted stdio connection with a fixed actor.
    pub fn with_brain_start(mut self) -> Self {
        self.allow_brain_start = self
            .agent_name
            .as_deref()
            .is_some_and(|n| !n.trim().is_empty());
        self
    }
    pub fn with_project_manager(mut self, manager: Arc<jam_core::ProjectManager>) -> Self {
        self.project_manager = Some(manager);
        self
    }
    pub fn with_project(mut self, project: Option<String>) -> Self {
        self.project_hint = project;
        self
    }
    fn session_store(&self) -> jam_core::Result<Arc<Store>> {
        self.session_store
            .get()
            .map(|b| {
                b.store.validate_session_generation(&b.generation)?;
                Ok::<_, jam_core::Error>(b.store.clone())
            })
            .transpose()?
            .ok_or_else(|| {
                jam_core::Error::Forbidden("This session has not bound a project".into())
            })
    }
    async fn bind_project(&self, ctx: &RequestContext<RoleServer>) -> Result<(), ErrorData> {
        let header = ctx
            .extensions
            .get::<axum::http::request::Parts>()
            .and_then(|parts| parts.headers.get("X-Jam-Project"))
            .map(|v| {
                v.to_str().map(str::to_owned).map_err(|_| {
                    ErrorData::invalid_params("Invalid explicit project selector", None)
                })
            })
            .transpose()?;
        let folder_header = ctx
            .extensions
            .get::<axum::http::request::Parts>()
            .and_then(|parts| parts.headers.get("X-Jam-Project-Folder"))
            .map(crate::http::decode_project_folder_header)
            .transpose()?;
        let requested = header.clone().or_else(|| self.project_hint.clone());
        // Inline clients may begin with any request and send concurrent lists.
        // Resolve the active project only once, even if the desktop later switches.
        let binding = self
            .session_store
            .get_or_try_init(|| async {
                let base = self.store.clone();
                let selector = requested.clone();
                let manager = self.project_manager.clone();
                let folder = folder_header.clone();
                let scoped = tokio::task::spawn_blocking(move || {
                    if let Some(manager) = manager {
                        let use_registry = folder.is_some()
                            || selector.as_ref().is_some_and(|id| {
                                manager.registry.entries().is_ok_and(|entries| {
                                    entries.iter().any(|e| e.project_id == *id)
                                })
                            })
                            || selector.is_none() && manager.capture_selected().is_ok();
                        if use_registry {
                            return manager
                                .resolve_handle(selector.as_deref(), folder.as_deref())
                                .map(|h| h.store.clone());
                        }
                    } else if folder.is_some() {
                        return Err(jam_core::Error::Forbidden(
                            "Folder header needs the app registry resolver".into(),
                        ));
                    }
                    let selected = selector
                        .map(Ok)
                        .unwrap_or_else(|| base.active_jam().map(|j| j.id))?;
                    base.for_project(&selected).map(Arc::new)
                })
                .await
                .map_err(internal)?
                .map_err(|e| {
                    ErrorData::invalid_params(format!("Cannot bind Jam Board project: {e}"), None)
                })?;
                let _ = self.session_identity.set(self.identity(ctx));
                let _ = self.session_client.set(raw_client(ctx));
                let context = scoped.folder_session_context().map_err(internal)?;
                let lease = scoped.project_lease().map_err(internal)?;
                let folder = context
                    .project_folder
                    .map(std::path::PathBuf::from)
                    .map(|p| p.canonicalize())
                    .transpose()
                    .map_err(internal)?;
                Ok::<_, ErrorData>(ProjectBinding {
                    folder,
                    generation: context.database_generation,
                    _lease: lease,
                    store: scoped,
                    selector: requested.clone(),
                })
            })
            .await?;
        if let Some(folder) = folder_header
            && binding.folder.as_ref() != Some(&folder.canonicalize().map_err(internal)?)
        {
            return Err(ErrorData::invalid_params(
                "This session is already bound; reconnect to change folders",
                None,
            ));
        }
        // An explicit subsequent selector must still address the captured project.
        if let Some(requested) = header {
            let bound = binding.store.bound_project_id().map_err(internal)?;
            if bound.as_deref() == Some(requested.as_str())
                || binding.selector.as_deref() == Some(requested.as_str())
            {
                return Ok(());
            }
            let base = self.store.clone();
            let selected = tokio::task::spawn_blocking(move || {
                base.list_projects(true).map(|projects| {
                    projects
                        .into_iter()
                        .find(|p| p.jam.id == requested || p.jam.key_prefix == requested)
                        .map(|p| p.jam.id)
                })
            })
            .await
            .map_err(internal)?
            .map_err(|e| {
                ErrorData::invalid_params(format!("Cannot bind Jam Board project: {e}"), None)
            })?;
            if selected != bound {
                return Err(ErrorData::invalid_params(
                    "This session is already bound. Reconnect to change projects.",
                    None,
                ));
            }
        }
        Ok(())
    }
    pub fn report_stdio_calls(mut self) -> Self {
        self.report_stdio = true;
        self
    }
    fn identity(&self, ctx: &RequestContext<RoleServer>) -> (String, String) {
        if let Some(identity) = self.session_identity.get() {
            return identity.clone();
        }
        let info = ctx
            .peer
            .peer_info()
            .map(|i| i.client_info.name.clone())
            .or_else(|| ctx.meta.client_info().map(|i| i.name));
        let lower = info.as_deref().unwrap_or_default().to_lowercase();
        let (client, default) = if lower.starts_with("codex") {
            ("codex", "Codex")
        } else if lower == "claude-code" {
            ("claude-code", "Claude")
        } else {
            ("other", info.as_deref().unwrap_or("Agent"))
        };
        let header = ctx
            .extensions
            .get::<axum::http::request::Parts>()
            .and_then(|parts| parts.headers.get("X-Jam-Agent"))
            .and_then(|s| s.to_str().ok())
            .map(str::to_string);
        (
            header
                .or_else(|| self.agent_name.clone())
                .or_else(|| info.as_ref().map(|_| default.into()))
                .unwrap_or_else(|| "Agent".into()),
            client.into(),
        )
    }
    async fn heartbeat(&self, ctx: &RequestContext<RoleServer>) -> Result<Member, ErrorData> {
        self.bind_project(ctx).await?;
        let (name, client) = self.identity(ctx);
        let store = self
            .session_store()
            .map_err(internal)?
            .with_activity_client(self.session_client.get().cloned());
        tokio::task::spawn_blocking(move || store.identify_agent(&name, &client))
            .await
            .map_err(internal)?
            .map_err(internal)
    }
    fn execute(&self, actor: &Member, name: &str, args: Value) -> jam_core::Result<Value> {
        let result = self.execute_inner(actor, name, args.clone())?;
        if let Some(kind) = mutation_kind(name) {
            let mut compact = jam_core::compact_mutation(kind, &result);
            if compact.get("id").is_none() {
                for field in ["assetId", "itemId", "frameId", "id"] {
                    if let Some(id) = args.get(field) {
                        compact["id"] = id.clone();
                        break;
                    }
                }
            }
            if compact["id"].as_str().is_none() {
                return Err(jam_core::Error::Validation {
                    field: "result".into(),
                    reason: format!("{name} did not identify its result"),
                });
            }
            return Ok(compact);
        }
        Ok(result)
    }
    fn execute_inner(&self, actor: &Member, name: &str, args: Value) -> jam_core::Result<Value> {
        let store = self
            .session_store()?
            .with_activity_client(self.session_client.get().cloned());
        if let Some(result) = crate::v2::execute(&store, actor, name, args.clone()) {
            return result;
        }
        match name {
            "get_session_context" => {
                let input = parse::<SessionContextInput>(args)?;
                let (project, latest_activity_cursor) = store.project_activity_context()?;
                let folder = store.folder_session_context()?;
                value(SessionContext {
                    server_version: env!("CARGO_PKG_VERSION").into(),
                    schema_version: store.schema_version()?,
                    capabilities: [
                        "idempotency.all",
                        "import.v1",
                        "externalRef",
                        "compact.v1",
                        "files.scopes",
                        "files.archive",
                        "files.revisions",
                        "files.preview",
                        "moves.v1",
                        "prompts.resources",
                        "references.batch",
                        "references.collect",
                        "agent.avatar",
                    ]
                    .into_iter()
                    .chain(self.allow_brain_start.then_some("execution.brainStart"))
                    .map(str::to_owned)
                    .collect(),
                    project_instance_id: folder.project_instance_id,
                    database_generation: folder.database_generation,
                    board_revision: folder.board_revision,
                    repository_root: folder.repository_root,
                    working_directory: folder.working_directory,
                    folder_rules: folder.folder_rules,
                    manifest_revision: folder.manifest_revision,
                    file_capabilities: folder.file_capabilities,
                    project_id: project.id,
                    key_prefix: project.key_prefix,
                    project_name: project.name,
                    actor: input.include_actor.then(|| actor.into()),
                    project_folder: folder
                        .project_folder
                        .or(store.get_settings()?.project_folder)
                        .map(|p| jam_core::display_path(std::path::Path::new(&p))),
                    binding: "session".into(),
                    can_switch_project: false,
                    latest_activity_cursor,
                })
            }
            "set_agent_avatar" => {
                let input = parse::<jam_core::AgentAvatarInput>(args)?;
                value(store.set_agent_avatar(&actor.id, input)?)
            }
            "brain_start_execution" => {
                if !self.allow_brain_start {
                    return Err(jam_core::Error::Forbidden(
                        "Delegated Start is disabled for this connection".into(),
                    ));
                }
                value(store.brain_start_execution(&actor.id, parse(args)?)?)
            }
            "get_board" => {
                parse::<Empty>(args)?;
                store.board(Some(&actor.id))
            }
            "list_tasks" => {
                let filter = parse::<TaskFilter>(args)?;
                let fields = filter.fields.clone();
                let mut page = value(store.list_tasks(Some(&actor.id), filter)?)?;
                if let Some(fields) = fields
                    && let Some(rows) = page["tasks"].as_array_mut()
                {
                    for row in rows {
                        if let Some(object) = row.as_object_mut() {
                            object.retain(|key, _| {
                                key == "key" || fields.iter().any(|field| field.as_str() == key)
                            });
                        }
                    }
                }
                Ok(page)
            }
            "get_task" => store.get_task_compact(parse::<jam_core::GetTaskInput>(args)?),
            "create_task" => value(store.create_task(&actor.id, parse::<CreateTask>(args)?)?),
            "update_task" => value(store.update_task(&actor.id, parse::<UpdateTask>(args)?)?),
            "move_task" => {
                let a = parse::<Move>(args)?;
                value(store.move_task_with_override(
                    &actor.id,
                    &a.key,
                    &a.status,
                    a.before_key.as_deref(),
                    a.after_key.as_deref(),
                    a.override_reason.as_deref(),
                    Some(&a.context()),
                )?)
            }
            "claim_task" => {
                let a = parse::<Claim>(args)?;
                value(store.claim_task(&actor.id, &a.key, Some(&a.context()))?)
            }
            "release_task" => {
                let a = parse::<Release>(args)?;
                value(store.release_task(
                    &actor.id,
                    &a.key,
                    a.status.as_deref(),
                    Some(&a.expected_claim_generation),
                )?)
            }
            "add_comment" => {
                let a = parse::<AddComment>(args)?;
                value(store.add_comment(&actor.id, &a.key, &a.body)?)
            }
            "archive_task" => {
                let a = parse::<Archive>(args)?;
                value(store.archive_task(
                    &actor.id,
                    &a.key,
                    a.reason.as_deref(),
                    Some(&a.context()),
                )?)
            }
            "list_members" => {
                parse::<Empty>(args)?;
                value(store.list_members()?)
            }
            "register_file" => value(store.register_file(&actor.id, parse(args)?)?),
            "link_task_file" => value(store.link_task_file(&actor.id, parse(args)?)?),
            "set_task_file_role" => value(store.set_task_file_role(&actor.id, parse(args)?)?),
            "unlink_task_file" => value(store.unlink_task_file(&actor.id, parse(args)?)?),
            "resolve_file" => value(store.resolve_file(parse(args)?)?),
            "list_assets" => {
                let a = parse::<jam_core::FileAssetQuery>(args)?;
                if a.limit.is_some() || a.cursor.is_some() {
                    let offset = a
                        .cursor
                        .as_deref()
                        .unwrap_or("0")
                        .parse::<usize>()
                        .map_err(|_| jam_core::Error::Validation {
                            field: "cursor".into(),
                            reason: "Invalid offset".into(),
                        })?;
                    let limit = a.limit.unwrap_or(100);
                    let mut q = a;
                    q.limit = Some(limit);
                    let items = store.list_file_assets(q.clone())?;
                    q.cursor = Some((offset + items.len()).to_string());
                    q.limit = Some(1);
                    let next = if store.list_file_assets(q)?.is_empty() {
                        None
                    } else {
                        Some((offset + items.len()).to_string())
                    };
                    Ok(json!({"assets":items,"nextCursor":next}))
                } else {
                    value(store.list_file_assets(a)?)
                }
            }
            _ => Err(jam_core::Error::NotFound(format!("tool {name}"))),
        }
    }
}
pub(crate) fn parse<T: DeserializeOwned + JsonSchema>(v: Value) -> jam_core::Result<T> {
    let root = serde_json::to_value(schema::<T>())?;
    validate_enum_fields(&root, &root, &v, "")?;
    serde_json::from_value(v).map_err(|e| jam_core::Error::Validation {
        field: "arguments".into(),
        reason: e.to_string(),
    })
}
fn enum_values(schema: &Value, root: &Value, values: &mut Vec<Value>) {
    if let Some(reference) = schema["$ref"].as_str().and_then(|r| r.strip_prefix('#'))
        && let Some(target) = root.pointer(reference)
    {
        enum_values(target, root, values);
    }
    if let Some(allowed) = schema["enum"].as_array() {
        values.extend(allowed.iter().cloned());
    }
    if let Some(value) = schema.get("const") {
        values.push(value.clone());
    }
    if schema["type"] == "null" {
        values.push(Value::Null);
    }
    for keyword in ["oneOf", "anyOf", "allOf"] {
        if let Some(variants) = schema[keyword].as_array() {
            for variant in variants {
                enum_values(variant, root, values);
            }
        }
    }
}
fn validate_enum_fields(
    schema: &Value,
    root: &Value,
    value: &Value,
    path: &str,
) -> jam_core::Result<()> {
    let mut allowed = vec![];
    enum_values(schema, root, &mut allowed);
    // A nullable, otherwise unrestricted schema does not constrain non-null values.
    if allowed.iter().any(|v| !v.is_null()) && !allowed.contains(value) {
        let choices = allowed
            .iter()
            .filter(|v| !v.is_null())
            .map(|v| {
                format!(
                    "`{}`",
                    v.as_str()
                        .map(str::to_owned)
                        .unwrap_or_else(|| v.to_string())
                )
            })
            .collect::<Vec<_>>()
            .join(", ");
        return Err(jam_core::Error::Validation {
            field: path.into(),
            reason: format!(
                "unknown variant `{}`, expected one of {choices}",
                value
                    .as_str()
                    .map(str::to_owned)
                    .unwrap_or_else(|| value.to_string())
            ),
        });
    }
    if allowed.iter().any(|v| !v.is_null()) {
        return Ok(());
    }
    if let Some(reference) = schema["$ref"].as_str().and_then(|r| r.strip_prefix('#'))
        && let Some(target) = root.pointer(reference)
    {
        validate_enum_fields(target, root, value, path)?;
    }
    if let Some(object) = value.as_object()
        && let Some(properties) = schema["properties"].as_object()
    {
        for (field, child) in object {
            if let Some(schema) = properties.get(field) {
                let path = if path.is_empty() {
                    field.clone()
                } else {
                    format!("{path}.{field}")
                };
                validate_enum_fields(schema, root, child, &path)?;
            }
        }
    }
    if let Some(items) = value.as_array()
        && let Some(schema) = schema.get("items")
    {
        for (i, item) in items.iter().enumerate() {
            validate_enum_fields(schema, root, item, &format!("{path}[{i}]"))?;
        }
    }
    for keyword in ["oneOf", "anyOf", "allOf"] {
        if let Some(variants) = schema[keyword].as_array() {
            for variant in variants {
                if variant["type"] != "null" {
                    validate_enum_fields(variant, root, value, path)?;
                }
            }
        }
    }
    Ok(())
}
pub(crate) fn value<T: Serialize>(v: T) -> jam_core::Result<Value> {
    Ok(serde_json::to_value(v)?)
}
fn internal(e: impl std::fmt::Display) -> ErrorData {
    ErrorData::internal_error(e.to_string(), None)
}
fn schema<T: JsonSchema>() -> JsonObject {
    schemars::schema_for!(T)
        .as_object()
        .expect("object schema")
        .clone()
}
pub(crate) fn tool<T: JsonSchema>(
    name: &'static str,
    description: &'static str,
    read_only: bool,
) -> Tool {
    let mut input = schema::<T>();
    if name == "create_task" {
        let required = input.entry("required").or_insert_with(|| json!([]));
        if let Some(a) = required.as_array_mut()
            && !a.iter().any(|v| v == "storyKey")
        {
            a.push(json!("storyKey"));
        }
    }
    if ["link_task_file", "set_task_file_role"].contains(&name)
        && let Some(required) = input.get_mut("required").and_then(Value::as_array_mut)
        && !required.iter().any(|v| v == "role")
    {
        required.push(json!("role"));
    }
    let freshness = match name {
        "claim_task" | "move_task" | "mark_ready" | "archive_task" | "update_task"
        | "update_task_brief" => {
            " Required: expectedClaimGeneration and expectedUpdatedAt captured from get_task before deciding this mutation. On stale_claim/conflict, reread and reconcile; never blindly refresh validators and replay."
        }
        "release_task" | "submit_report" => {
            " Required: expectedClaimGeneration from the claim you are returning/reporting, not a later same-identity claim. A stale_claim rejects the old payload without mutation; do not relabel it with a fresh validator."
        }
        "review_task" => {
            " Required: expectedReportId and expectedReviewContextRevision captured from the exact current report and TaskDetail.reviewContextRevision you inspected. A changed report/task/story/epic context conflicts; reread evidence and reconsider the decision."
        }
        _ => "",
    };
    let mut result = Tool::new(name, format!("{description}{freshness}"), input).with_annotations(
        ToolAnnotations::new()
            .read_only(read_only)
            .destructive(false)
            .open_world(false),
    );
    let output = match name {
        "import_plan" => Some(schema::<jam_core::ImportPlanReport>()),
        "undo_import" => Some(schema::<jam_core::UndoImportReport>()),
        "list_import_batches" => Some(schema::<Vec<jam_core::ImportBatchSummary>>()),
        "find" => Some(schema::<Vec<jam_core::RecordVersion>>()),
        "asset_usage" => Some(schema::<jam_core::AssetUsage>()),
        "list_asset_revisions" => Some(schema::<Vec<jam_core::AssetRevision>>()),
        "list_assets" => Some(schema::<Vec<jam_core::FileAsset>>()),
        "create_task" | "update_task" | "get_task" | "claim_task" => {
            Some(schema::<jam_core::TaskDetail>())
        }
        "register_file" | "link_task_file" | "set_task_file_role" | "unlink_task_file" => {
            Some(schema::<jam_core::FileMutationResult>())
        }
        "resolve_file" => Some(schema::<jam_core::FileResolution>()),
        "get_execution" | "brain_start_execution" => Some(schema::<jam_core::ExecutionState>()),
        "get_canvas" => Some(schema::<jam_core::CanvasPage>()),
        "create_frame" | "update_frame" => Some(schema::<jam_core::RefFrame>()),
        "connect_references" | "update_connection" => Some(schema::<jam_core::RefEdge>()),
        "request_execution" => Some(schema::<jam_core::ExecutionRequest>()),
        "get_session_context" => Some(schema::<SessionContext>()),
        "list_tasks" => Some(schema::<jam_core::TaskPage>()),
        "move_task" | "release_task" | "archive_task" => Some(schema::<jam_core::TaskSummary>()),
        "add_comment" => Some(schema::<jam_core::Comment>()),
        "get_project" => Some(schema::<jam_core::Project>()),
        "get_epic" => Some(schema::<jam_core::EpicTree>()),
        "create_epic" | "update_epic" | "set_epic_status" | "become_brain" | "set_brain" => {
            Some(schema::<jam_core::Epic>())
        }
        "create_story" | "update_story" | "set_story_status" => Some(schema::<jam_core::Story>()),
        "update_task_brief" => Some(schema::<jam_core::TaskDetail>()),
        "check_ready" => Some(schema::<jam_core::Readiness>()),
        "mark_ready" => Some(schema::<jam_core::TaskSummary>()),
        "submit_report" => Some(schema::<jam_core::Report>()),
        "review_task" => Some(schema::<jam_core::Review>()),
        "ask_user" | "withdraw_question" => Some(schema::<jam_core::Question>()),
        "wait_for_answer" => Some(schema::<jam_core::AnswerWait>()),
        "wait_for_changes" => Some(schema::<jam_core::ChangesWait>()),
        "set_status" | "set_agent_avatar" => Some(schema::<jam_core::Member>()),
        "add_references" => Some(schema::<jam_core::AddReferencesResult>()),
        "collect_kept_references" => Some(schema::<jam_core::CollectKeptResult>()),
        "add_reference" | "link_reference" | "update_reference" => {
            Some(schema::<jam_core::RefItem>())
        }
        _ => None,
    };
    let output = if mutation_kind(name).is_some() {
        Some(schema::<jam_core::CompactMutation>())
    } else {
        match name {
            "get_epic" => Some(schema::<jam_core::CompactEpic>()),
            "get_task" => Some(schema::<jam_core::CompactTask>()),
            "list_tasks" => Some(schema::<jam_core::ProjectedTaskPage>()),
            _ => output,
        }
    };
    if let Some(output) = output {
        result.output_schema = Some(Arc::new(output));
    }
    result
}
fn tools() -> Vec<Tool> {
    let mut list = vec![
        tool::<SessionContextInput>(
            "get_session_context",
            "Read this session's pinned project identity and project-filtered latestActivityCursor in one snapshot. Set includeActor to verify the connection's own member before worker writes. Capture the cursor before fresh current-state reads; never replace an unprocessed saved recovery cursor. Human project switching does not retarget this connection. Reconnect with JAM_BOARD_PROJECT or X-Jam-Project to change it.",
            true,
        ),
        tool::<Empty>(
            "get_board",
            "Read the active jam, column counts, in-progress work, your tasks, and online agents. timeLeft is seconds until the deadline, clamped to zero.",
            true,
        ),
        tool::<TaskFilter>(
            "list_tasks",
            "Find tasks by status, assignee handle (or me/unassigned), tag, and title/description substring. Follow nextCursor for more results; limit defaults to 50 and is at most 200.",
            true,
        ),
        tool::<jam_core::GetTaskInput>(
            "get_task",
            "Read a task's full playbook brief, story intent and acceptance, epic context, references, reports, reviews, comments and the last 50 activity events. For example, read JB-12 before claiming it.",
            true,
        ),
        tool::<CreateTask>(
            "create_task",
            "Create a task under the required storyKey; status defaults to backlog and priority to medium. Accepts the complete brief fields. A stable requestId is required for retry-safe creation. Agents cannot create Done tasks; completion requires independent review_task evidence.",
            false,
        ),
        tool::<UpdateTask>(
            "update_task",
            "Edit a task by key; provided tags replace the full tag list. Omit estimate/dueAt to preserve them or pass null to clear them; archived tasks cannot be edited.",
            false,
        ),
        tool::<Move>(
            "move_task",
            "Move a task to a status and optionally between adjacent neighbors. Workers must enter work with claim_task and Review with submit_report, and cannot move another holder's task. Humans and the appointed epic brain may plan statuses, but entry into In progress always requires a human-started story/epic. Agents cannot move directly to Done; use review_task with an independent report. afterKey precedes the moved task and beforeKey follows it; omit both to append.",
            false,
        ),
        tool::<Claim>(
            "claim_task",
            "Claim a Ready task for yourself and move it to In progress. Workers cannot claim other statuses or bypass readiness. A task held by another member returns claim_conflict with the holder's name. New work requires a running story or epic; Ready alone is not execution permission.",
            false,
        ),
        tool::<Release>(
            "release_task",
            "Release a task you hold and move it to backlog or the supplied status. Only the current holder or a human can release it. Returning an existing claim to Backlog or Ready is allowed after task/parent archival without restoring or starting work; Ready still validates readiness. Agents cannot release directly to Done; use independent review_task.",
            false,
        ),
        tool::<AddComment>(
            "add_comment",
            "Add a Markdown comment of 1–4000 characters to a task. Worker submissions use submit_report; comments can explain progress or a question.",
            false,
        ),
        tool::<Archive>(
            "archive_task",
            "Archive a task without deleting it. An optional reason is stored as a comment in the same transaction; only humans can restore archived tasks.",
            false,
        ),
        tool::<Empty>(
            "list_members",
            "List humans and agents with counts by status, online presence, and in-progress task keys. Agents are online for 120 seconds after their most recent call.",
            true,
        ),
        tool::<jam_core::FileAssetQuery>(
            "list_assets",
            "List files with ownership, stored paths and per-context status. Optional storageType/taskKey/role filters. Without limit/cursor returns the legacy unpaginated array; paging returns {assets,nextCursor}.",
            true,
        ),
    ];
    list.extend([
        tool::<jam_core::RegisterFile>("register_file","Register/copy a board file, link a local file, or register an HTTP(S) URL. Read folderRules first. requestId is idempotent. Optional task association needs both inspected validators. Never executes or downloads files.",false),
        tool::<jam_core::TaskFileInput>("link_task_file","Link an existing same-project file to a task with to_edit, reference or result role. Requires captured task validators and requestId.",false),
        tool::<jam_core::TaskFileInput>("set_task_file_role","Change one task/file role and optional order. Requires captured task validators and requestId.",false),
        tool::<jam_core::TaskFileInput>("unlink_task_file","Remove only a task/file association; keep bytes, references and history. Requires captured task validators and requestId.",false),
        tool::<jam_core::ResolveFile>("resolve_file","Resolve a file without opening/executing/downloading it. workingDirectory is a resolution hint, never authority; its repository must match the board anchor.",true),
    ]);
    list.extend(crate::v2::tools());
    list
}
/// The same schemas served by tools/list; useful for offline integration contracts.
pub fn tool_catalog() -> Vec<Tool> {
    tools()
}

impl ServerHandler for JamServer {
    async fn initialize(
        &self,
        request: InitializeRequestParams,
        ctx: RequestContext<RoleServer>,
    ) -> Result<InitializeResult, ErrorData> {
        ctx.peer.set_peer_info(request.clone());
        self.heartbeat(&ctx).await?;
        self.negotiate_initialize(&request)
    }
    async fn discover(&self, ctx: RequestContext<RoleServer>) -> Result<DiscoverResult, ErrorData> {
        self.heartbeat(&ctx).await?;
        Ok(DiscoverResult::from_server_info(
            self.supported_protocol_versions().into_owned(),
            self.get_info(),
        ))
    }
    async fn complete(
        &self,
        _: CompleteRequestParams,
        ctx: RequestContext<RoleServer>,
    ) -> Result<CompleteResult, ErrorData> {
        self.heartbeat(&ctx).await?;
        Ok(CompleteResult::default())
    }
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().enable_resources().enable_prompts().build()).with_server_info(Implementation::new("jam-board",env!("CARGO_PKG_VERSION"))).with_instructions("Read jam://guide for this version’s standalone board workflow; no external playbook is required. This connection is pinned to one project on its first request; get_session_context identifies it. Switching projects in the app never retargets this session. Plan your project with your AI teammates. Use task keys such as JB-12. Ready describes planning, not execution authority. Check get_execution for the story. Follow the Start routes in jam://guide; generic questions and Ready do not grant authority. Never launch agent sessions merely because a request was created. When a scope is running, read get_task and claim a Ready task with its expectedClaimGeneration and expectedUpdatedAt; retain the returned claimGeneration for report/release. submit_report with that expectedClaimGeneration and results/test evidence. Covered task overwrites/status mutations require both captured validators; missing context fails closed. Review_task requires expectedReportId and expectedReviewContextRevision from the exact evidence inspected. Never blindly refresh validators and replay a rejected old payload. Pause blocks new work but preserves in-flight reports. A separate human or appointed brain reviews the report with review_task; never review your own work.")
    }
    async fn list_tools(
        &self,
        _: Option<PaginatedRequestParams>,
        ctx: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, ErrorData> {
        self.heartbeat(&ctx).await?;
        let mut tools = tools();
        tools.push(tool::<jam_core::AgentAvatarInput>(
            "set_agent_avatar",
            "Set this connection's own agent avatar to a PNG data URL, or pass null to restore the provider default. PNG limit: 32 KiB decoded and 128 by 128 pixels.",
            false,
        ));
        if self.allow_brain_start {
            tools.push(tool::<jam_core::BrainStartExecution>(
                "brain_start_execution",
                "Appointed epic brain only. Start the exact story or epic only after the human directly requests Start for that scope in this conversation. Use the revision from get_execution. This trusted connection cannot verify chat text. Start grants board execution and does not launch workers.",
                false,
            ));
        }
        Ok(ListToolsResult {
            tools,
            ..Default::default()
        })
    }
    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        ctx: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, ErrorData> {
        self.bind_project(&ctx).await?;
        let (name, client) = self.identity(&ctx);
        let this = self.clone();
        let tool_name = request.name.to_string();
        let record_name = tool_name.clone();
        let args = Value::Object(request.arguments.unwrap_or_default());
        let result = tokio::task::spawn_blocking(move || {
            let actor = this
                .session_store()?
                .with_activity_client(this.session_client.get().cloned())
                .identify_agent(&name, &client)?;
            this.execute(&actor, &tool_name, args)
        })
        .await;
        let result = match result {
            Ok(r) => r,
            Err(e) => Err(jam_core::Error::Validation {
                field: "worker".into(),
                reason: e.to_string(),
            }),
        };
        let ok = result.is_ok();
        let (agent, _) = self.identity(&ctx);
        let call = RecentCall {
            project_id: self
                .session_store()
                .ok()
                .and_then(|s| s.bound_project_id().ok().flatten()),
            at: jam_core::now(),
            error: result.as_ref().err().map(ToString::to_string),
            agent,
            tool: record_name.clone(),
            ok,
        };
        if self.report_stdio {
            crate::runtime::report_stdio(&self.store, &call);
        }
        if let Ok(mut calls) = self.recent.lock() {
            calls.push_front(call);
            calls.truncate(20);
        }
        let response = match result {
            Ok(v) => {
                let mut r =
                    CallToolResult::success(vec![ContentBlock::text(summary(&record_name, &v))]);
                r.structured_content = Some(v);
                r
            }
            Err(e) => {
                let code = e.code();
                let message = e.protocol_message();
                let mut r = CallToolResult::error(vec![ContentBlock::text(&message)]);
                let mut data = json!({"code":code,"message":message});
                if let jam_core::Error::InUse { usage } = &e {
                    data["data"] = json!({"usage":usage});
                }
                if let jam_core::Error::Validation { field, .. } = &e {
                    data["field"] = json!(field);
                }
                r.structured_content = Some(data);
                r
            }
        };
        Ok(response.into())
    }
    async fn list_resources(
        &self,
        _: Option<PaginatedRequestParams>,
        ctx: RequestContext<RoleServer>,
    ) -> Result<ListResourcesResult, ErrorData> {
        self.heartbeat(&ctx).await?;
        Ok(ListResourcesResult {
            resources: vec![
                Resource::new("jam://board", "Active jam board").with_mime_type("text/markdown"),
                Resource::new("jam://guide", "Jam Board agent guide")
                    .with_mime_type("text/markdown"),
                Resource::new("jam://guide/operations", "Jam Board operation examples")
                    .with_mime_type("text/markdown"),
                Resource::new("jam://prompts/plan_epic", "Plan an epic protocol")
                    .with_mime_type("text/plain"),
                Resource::new(
                    "jam://prompts/work_on_next_task",
                    "Work on next task protocol",
                )
                .with_mime_type("text/plain"),
            ],
            ..Default::default()
        })
    }
    async fn list_resource_templates(
        &self,
        _: Option<PaginatedRequestParams>,
        ctx: RequestContext<RoleServer>,
    ) -> Result<ListResourceTemplatesResult, ErrorData> {
        self.heartbeat(&ctx).await?;
        Ok(ListResourceTemplatesResult {
            resource_templates: vec![
                ResourceTemplate::new("jam://epic/{key}", "Epic tree and journal")
                    .with_mime_type("text/markdown"),
                ResourceTemplate::new("jam://story/{key}", "Story intent and acceptance")
                    .with_mime_type("text/markdown"),
                ResourceTemplate::new("jam://task/{key}", "Task by key")
                    .with_mime_type("text/markdown"),
            ],
            ..Default::default()
        })
    }
    async fn read_resource(
        &self,
        request: ReadResourceRequestParams,
        ctx: RequestContext<RoleServer>,
    ) -> Result<ReadResourceResponse, ErrorData> {
        let actor = self.heartbeat(&ctx).await?;
        let is_codex = self.identity(&ctx).1 == "codex";
        let store = self.session_store().map_err(internal)?;
        let uri = request.uri;
        let text = tokio::task::spawn_blocking({
            let uri = uri.clone();
            move || -> jam_core::Result<String> {
                if let Some(name)=uri.strip_prefix("jam://prompts/") {
                    if !["plan_epic","work_on_next_task"].contains(&name) { return Err(jam_core::Error::NotFound(uri)); }
                    let mut text=crate::v2::prompt_with_args(name,Some("{epicKey}"),(name=="work_on_next_task").then_some("{tag}"),is_codex).ok_or_else(||jam_core::Error::NotFound(uri.clone()))?;
                    text.push_str("\n\nArguments: {epicKey} is an optional epic key, e.g. JB-E2; {tag} is an optional task tag filter for work_on_next_task.");
                    Ok(text)
                } else if uri == "jam://guide" {
                    Ok(
                        include_str!("../../../integrations/agent-skill/jam-board/SKILL.md")
                            .replace("references/operations.md", "jam://guide/operations"),
                    )
                } else if uri == "jam://guide/operations" {
                    Ok(include_str!(
                        "../../../integrations/agent-skill/jam-board/references/operations.md"
                    )
                    .replace("../SKILL.md", "jam://guide"))
                } else if uri == "jam://board" {
                    let b = store.board(Some(&actor.id))?;
                    let mut md = format!(
                        "# {}\n\nTheme: {}\n\n| Status | Count |\n|---|---|\n",
                        b["jam"]["name"].as_str().unwrap_or("Jam"),
                        b["jam"]["theme"].as_str().unwrap_or("—")
                    );
                    if let Some(cols) = b["columns"].as_array() {
                        for col in cols {
                            md.push_str(&format!(
                                "| {} | {} |\n",
                                col["status"].as_str().unwrap_or(""),
                                col["count"]
                            ));
                        }
                    }
                    md.push_str("\n## In progress\n");
                    if let Some(ts) = b["inProgress"].as_array() {
                        for t in ts {
                            md.push_str(&format!(
                                "- {}: {}\n",
                                t["key"].as_str().unwrap_or(""),
                                t["title"].as_str().unwrap_or("")
                            ));
                        }
                    }
                    md.push_str("\n## Waiting as a brain\n");
                    md.push_str(crate::v2::OBSERVATION_GUIDANCE);
                    md.push('\n');
                    Ok(md)
                } else if let Some(key) = uri.strip_prefix("jam://epic/") {
                    Ok(crate::v2::epic_markdown(&store.get_epic(key)?))
                } else if let Some(key) = uri.strip_prefix("jam://story/") {
                    Ok(crate::v2::story_markdown(&store.get_story(key)?))
                } else if let Some(key) = uri.strip_prefix("jam://task/") {
                    Ok(crate::v2::task_markdown(&store.get_task(key)?))
                } else {
                    Err(jam_core::Error::NotFound(uri))
                }
            }
        })
        .await
        .map_err(internal)?
        .map_err(|e| ErrorData::invalid_params(e.to_string(), None))?;
        Ok(ReadResourceResult::new(vec![ResourceContents::text(text, uri)]).into())
    }
    async fn list_prompts(
        &self,
        _: Option<PaginatedRequestParams>,
        ctx: RequestContext<RoleServer>,
    ) -> Result<ListPromptsResult, ErrorData> {
        self.heartbeat(&ctx).await?;
        Ok(ListPromptsResult {
            prompts: [
                ("plan_epic", "Interview, plan and prepare an epic."),
                (
                    "work_on_next_task",
                    "Work on a Ready task within a human-started scope and submit a report.",
                ),
                (
                    "review_task",
                    "Review evidence against the brief and acceptance.",
                ),
            ]
            .into_iter()
            .map(|(name, description)| {
                Prompt::new(
                    name,
                    Some(description),
                    if name == "work_on_next_task" {
                        Some(vec![
                            PromptArgument::new("epicKey").with_required(false),
                            PromptArgument::new("tag").with_required(false),
                        ])
                    } else if name == "plan_epic" {
                        Some(vec![PromptArgument::new("epicKey").with_required(false)])
                    } else {
                        None
                    },
                )
            })
            .collect(),
            ..Default::default()
        })
    }
    async fn get_prompt(
        &self,
        request: GetPromptRequestParams,
        ctx: RequestContext<RoleServer>,
    ) -> Result<GetPromptResponse, ErrorData> {
        self.heartbeat(&ctx).await?;
        let args = request.arguments.as_ref();
        let instruction = crate::v2::prompt_with_args(
            &request.name,
            args.and_then(|a| a.get("epicKey")).and_then(Value::as_str),
            args.and_then(|a| a.get("tag")).and_then(Value::as_str),
            self.identity(&ctx).1 == "codex",
        )
        .ok_or_else(|| ErrorData::invalid_params("Unknown prompt", None))?;
        Ok(GetPromptResult::new(vec![PromptMessage::new_text(Role::User, instruction)]).into())
    }
}

fn mutation_kind(name: &str) -> Option<&'static str> {
    Some(match name {
        "create_epic" | "update_epic" | "set_epic_status" | "become_brain" | "set_brain" => "epic",
        "create_story" | "update_story" | "set_story_status" | "move_story" => "story",
        "create_task" | "update_task" | "update_task_brief" | "mark_ready" | "move_task"
        | "claim_task" | "release_task" | "archive_task" | "move_task_to_story" => "task",
        "create_frame" | "update_frame" => "frame",
        "add_reference" | "update_reference" | "link_reference" | "unlink_reference" => "reference",
        "ask_user" | "withdraw_question" => "question",
        "register_file" | "link_task_file" | "set_task_file_role" | "unlink_task_file"
        | "rename_asset" | "replace_asset" | "delete_asset" | "archive_asset"
        | "unarchive_asset" => "asset",
        "link_file" | "unlink_file" => "scope_file",
        "update_connection" => "connection",
        _ => return None,
    })
}
fn summary(name: &str, v: &Value) -> String {
    let key = v["key"].as_str().unwrap_or("");
    let title = v["title"].as_str().unwrap_or("");
    match name {
        "create_task" => format!(
            "Created {key} in {}.",
            v["status"].as_str().unwrap_or("backlog")
        ),
        "claim_task" => format!("Claimed {key}."),
        "move_task" => format!("Moved {key} to {}.", v["status"].as_str().unwrap_or("")),
        "get_task" => format!("{key} · {title}"),
        "update_task" => format!("Updated {key}."),
        "list_tasks" => format!("Found {} tasks.", v["tasks"].as_array().map_or(0, Vec::len)),
        "list_members" | "list_assets" => {
            format!("Found {} entries.", v.as_array().map_or(0, Vec::len))
        }
        "get_board" => format!("Board: {}.", v["jam"]["name"].as_str().unwrap_or("Jam")),
        _ => format!("Completed {name} {key}."),
    }
}
#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct Empty {}
#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct Key {
    /// Stable item key in the connected project, e.g. JB-12; required.
    pub key: String,
}
#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Move {
    /// Stable board key of the item inspected, e.g. JB-12 or JB-E2; required for item operations.
    key: String,
    /// Opaque claimGeneration from the inspected task; required for covered writes. Preserve the exact captured token, e.g. generation:task:3.
    expected_claim_generation: String,
    /// Exact updatedAt captured before deciding this mutation, e.g. 2026-10-31T00:00:00Z. Never refresh it merely to replay a rejection.
    expected_updated_at: String,
    /// Enumerated workflow state or state filter. Creates default to backlog for tasks and draft for planning scopes; omitted updates preserve it.
    status: jam_core::TaskStatus,
    /// Sibling key to place before, e.g. JB-10; omitted appends unless afterKey is supplied.
    before_key: Option<String>,
    /// Sibling key to place after, e.g. JB-10; cannot be combined with beforeKey.
    after_key: Option<String>,
    /// Reason for a permitted human override; omitted uses normal validation. Example: Review manually accepted this evidence.
    override_reason: Option<String>,
}
#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Release {
    /// Stable board key of the item inspected, e.g. JB-12 or JB-E2; required for item operations.
    key: String,
    /// Opaque claimGeneration from the inspected task; required for covered writes. Preserve the exact captured token, e.g. generation:task:3.
    expected_claim_generation: String,
    /// Enumerated workflow state or state filter. Creates default to backlog for tasks and draft for planning scopes; omitted updates preserve it.
    status: Option<jam_core::TaskStatus>,
}
#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct AddComment {
    /// Stable board key of the item inspected, e.g. JB-12 or JB-E2; required for item operations.
    key: String,
    /// Comment in Markdown, 1–4000 characters; required. Example: Keep the existing image.
    body: String,
}
#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Archive {
    /// Stable board key of the item inspected, e.g. JB-12 or JB-E2; required for item operations.
    key: String,
    /// Opaque claimGeneration from the inspected task; required for covered writes. Preserve the exact captured token, e.g. generation:task:3.
    expected_claim_generation: String,
    /// Exact updatedAt captured before deciding this mutation, e.g. 2026-10-31T00:00:00Z. Never refresh it merely to replay a rejection.
    expected_updated_at: String,
    /// Reason for a scoped request, e.g. Ready for implementation; required. A request is not approval.
    reason: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Claim {
    /// Stable board key of the item inspected, e.g. JB-12 or JB-E2; required for item operations.
    key: String,
    /// Opaque claimGeneration from the inspected task; required for covered writes. Preserve the exact captured token, e.g. generation:task:3.
    expected_claim_generation: String,
    /// Exact updatedAt captured before deciding this mutation, e.g. 2026-10-31T00:00:00Z. Never refresh it merely to replay a rejection.
    expected_updated_at: String,
}
macro_rules! write_context {
    ($($name:ty),+) => {$(impl $name {
        fn context(&self) -> jam_core::TaskWriteContext {
            jam_core::TaskWriteContext {
                expected_claim_generation: self.expected_claim_generation.clone(),
                expected_updated_at: self.expected_updated_at.clone(),
            }
        }
    })+};
}
write_context!(Claim, Move, Archive);
