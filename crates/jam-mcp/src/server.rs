use jam_core::{CreateTask, Member, Store, TaskFilter, UpdateTask};
use rmcp::{ErrorData, RoleServer, ServerHandler, model::*, service::RequestContext};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
use std::sync::{Arc, Mutex, OnceLock};

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

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct SessionContext {
    project_id: String,
    key_prefix: String,
    project_name: String,
    binding: String,
    can_switch_project: bool,
}

#[derive(Clone)]
pub struct JamServer {
    store: Arc<Store>,
    session_store: Arc<OnceLock<Arc<Store>>>,
    session_identity: Arc<OnceLock<(String, String)>>,
    project_hint: Option<String>,
    agent_name: Option<String>,
    recent: RecentCalls,
    report_stdio: bool,
}
impl JamServer {
    pub fn new(store: Arc<Store>, agent_name: Option<String>, recent: RecentCalls) -> Self {
        Self {
            store,
            session_store: Arc::new(OnceLock::new()),
            session_identity: Arc::new(OnceLock::new()),
            project_hint: None,
            agent_name,
            recent,
            report_stdio: false,
        }
    }
    pub fn with_project(mut self, project: Option<String>) -> Self {
        self.project_hint = project;
        self
    }
    fn session_store(&self) -> jam_core::Result<Arc<Store>> {
        self.session_store.get().cloned().ok_or_else(|| {
            jam_core::Error::Forbidden(
                "Initialize this session with a project before making calls".into(),
            )
        })
    }
    async fn bind_project(&self, ctx: &RequestContext<RoleServer>) -> Result<(), ErrorData> {
        let header = ctx
            .extensions
            .get::<axum::http::request::Parts>()
            .and_then(|parts| parts.headers.get("X-Jam-Project"))
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned);
        let requested = header.or_else(|| self.project_hint.clone());
        let base = self.store.clone();
        let scoped = tokio::task::spawn_blocking(move || {
            let selected = requested
                .map(Ok)
                .unwrap_or_else(|| base.active_jam().map(|j| j.id))?;
            base.for_project(&selected).map(Arc::new)
        })
        .await
        .map_err(internal)?
        .map_err(|e| {
            ErrorData::invalid_params(format!("Cannot bind Jam Board project: {e}"), None)
        })?;
        if let Some(existing) = self.session_store.get() {
            if existing.bound_project_id().map_err(internal)?
                != scoped.bound_project_id().map_err(internal)?
            {
                return Err(ErrorData::invalid_params(
                    "This session is already bound. Reconnect to change projects.",
                    None,
                ));
            }
        } else {
            self.session_store
                .set(scoped)
                .map_err(|_| ErrorData::internal_error("Session binding raced", None))?;
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
            .client_info()
            .map(|i| i.name)
            .unwrap_or_else(|| "Agent".into());
        let lower = info.to_lowercase();
        let (client, default) = if lower.contains("codex") {
            ("codex", "Codex")
        } else if lower.contains("claude") {
            ("claude-code", "Claude")
        } else {
            ("other", info.as_str())
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
                .unwrap_or_else(|| default.into()),
            client.into(),
        )
    }
    async fn heartbeat(&self, ctx: &RequestContext<RoleServer>) -> Result<Member, ErrorData> {
        let (name, client) = self.identity(ctx);
        let store = self.session_store().map_err(internal)?;
        tokio::task::spawn_blocking(move || store.identify_agent(&name, &client))
            .await
            .map_err(internal)?
            .map_err(internal)
    }
    fn execute(&self, actor: &Member, name: &str, args: Value) -> jam_core::Result<Value> {
        let store = self.session_store()?;
        if let Some(result) = crate::v2::execute(&store, actor, name, args.clone()) {
            return result;
        }
        match name {
            "get_session_context" => {
                parse::<Empty>(args)?;
                let project = store.active_jam()?;
                value(SessionContext {
                    project_id: project.id,
                    key_prefix: project.key_prefix,
                    project_name: project.name,
                    binding: "session".into(),
                    can_switch_project: false,
                })
            }
            "get_board" => {
                parse::<Empty>(args)?;
                store.board(Some(&actor.id))
            }
            "list_tasks" => value(store.list_tasks(Some(&actor.id), parse::<TaskFilter>(args)?)?),
            "get_task" => value(store.get_task(&parse::<Key>(args)?.key)?),
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
                )?)
            }
            "claim_task" => value(store.claim_task(&actor.id, &parse::<Key>(args)?.key)?),
            "release_task" => {
                let a = parse::<Release>(args)?;
                value(store.release_task(&actor.id, &a.key, a.status.as_deref())?)
            }
            "add_comment" => {
                let a = parse::<AddComment>(args)?;
                value(store.add_comment(&actor.id, &a.key, &a.body)?)
            }
            "archive_task" => {
                let a = parse::<Archive>(args)?;
                value(store.archive_task(&actor.id, &a.key, a.reason.as_deref())?)
            }
            "list_members" => {
                parse::<Empty>(args)?;
                value(store.list_members()?)
            }
            "list_assets" => {
                let a = parse::<Assets>(args)?;
                value(store.list_assets(a.kind.as_deref(), a.query.as_deref())?)
            }
            _ => Err(jam_core::Error::NotFound(format!("tool {name}"))),
        }
    }
}
pub(crate) fn parse<T: DeserializeOwned>(v: Value) -> jam_core::Result<T> {
    serde_json::from_value(v).map_err(|e| jam_core::Error::Validation {
        field: "arguments".into(),
        reason: e.to_string(),
    })
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
    // Schema hints use the domain's vocabulary; validation still runs in jam-core
    // so invalid tool input becomes isError rather than a JSON-RPC protocol error.
    if let Some(properties) = input.get_mut("properties").and_then(Value::as_object_mut) {
        if name == "create_task" {
            properties.insert("storyKey".into(), json!({"type":"string","minLength":1}));
        }
        if name == "add_reference" {
            properties.insert(
                "kind".into(),
                json!({"type":"string","enum":["asset","link","note"]}),
            );
        }
        if name == "wait_for_changes" {
            properties.insert("cursor".into(), json!({"type":"integer","minimum":0}));
            properties.insert(
                "timeoutSeconds".into(),
                json!({"type":"integer","minimum":1,"maximum":60,"default":30}),
            );
            properties.insert(
                "actorKind".into(),
                json!({"type":["string","null"],"enum":["human","agent",null]}),
            );
            properties.insert("actions".into(), json!({"type":["array","null"],"items":{"type":"string","enum":jam_core::ACTIVITY_ACTIONS}}));
        }
        if name == "review_task" {
            properties.insert(
                "verdict".into(),
                json!({"type":"string","enum":["accept","changes_requested"]}),
            );
        }
        if let Some(status) = properties.get_mut("status") {
            if name == "list_questions" {
                *status =
                    json!({"type":["string","null"],"enum":["open","answered","withdrawn",null]});
            } else if ["set_epic_status", "set_story_status"].contains(&name) {
                *status = json!({"type":"string","enum":["draft","active","done","archived"]});
            } else {
                *status = if name == "list_tasks" {
                    json!({"type":["array","null"],"items":{"type":"string","enum":jam_core::STATUSES}})
                } else if name == "move_task" {
                    json!({"type":"string","enum":jam_core::STATUSES})
                } else {
                    let mut choices = jam_core::STATUSES
                        .iter()
                        .map(|s| json!(s))
                        .collect::<Vec<_>>();
                    choices.push(Value::Null);
                    json!({"type":["string","null"],"enum":choices})
                };
            }
        }
        if let Some(priority) = properties.get_mut("priority") {
            let mut choices = jam_core::PRIORITIES
                .iter()
                .map(|s| json!(s))
                .collect::<Vec<_>>();
            choices.push(Value::Null);
            *priority = json!({"type":["string","null"],"enum":choices});
        }
    }
    if name == "create_task" {
        let required = input.entry("required").or_insert_with(|| json!([]));
        if let Some(a) = required.as_array_mut()
            && !a.iter().any(|v| v == "storyKey")
        {
            a.push(json!("storyKey"));
        }
    }
    let mut result = Tool::new(name, description, input).with_annotations(
        ToolAnnotations::new()
            .read_only(read_only)
            .destructive(false)
            .open_world(false),
    );
    let output = match name {
        "create_task" | "update_task" | "get_task" | "claim_task" => {
            Some(schema::<jam_core::TaskDetail>())
        }
        "get_execution" => Some(schema::<jam_core::ExecutionState>()),
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
        "set_status" => Some(schema::<jam_core::Member>()),
        "add_reference" | "link_reference" | "update_reference" => {
            Some(schema::<jam_core::RefItem>())
        }
        _ => None,
    };
    if let Some(output) = output {
        result.output_schema = Some(Arc::new(output));
    }
    result
}
fn tools() -> Vec<Tool> {
    let mut list = vec![
        tool::<Empty>(
            "get_session_context",
            "Read this session's pinned project identity. Human project switching does not retarget this connection. Reconnect with JAM_BOARD_PROJECT or X-Jam-Project to change it.",
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
        tool::<Key>(
            "get_task",
            "Read a task's full playbook brief, story intent and acceptance, epic context, references, reports, reviews, comments and the last 50 activity events. For example, read JB-12 before claiming it.",
            true,
        ),
        tool::<CreateTask>(
            "create_task",
            "Create a task under the required storyKey; status defaults to backlog and priority to medium. Accepts the complete brief fields. Supply idempotencyKey to safely retry without creating duplicates. Agents cannot create Done tasks; completion requires independent review_task evidence.",
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
        tool::<Key>(
            "claim_task",
            "Claim a Ready task for yourself and move it to In progress. Workers cannot claim other statuses or bypass readiness. A task held by another member returns claim_conflict with the holder's name. New work requires a human-started story/epic; Ready alone is not execution permission.",
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
        tool::<Assets>(
            "list_assets",
            "List asset references in the active jam, optionally filtered by kind and text. Files stay at their original locations and are never copied.",
            true,
        ),
    ];
    list.extend(crate::v2::tools());
    list
}

impl ServerHandler for JamServer {
    async fn initialize(
        &self,
        request: InitializeRequestParams,
        ctx: RequestContext<RoleServer>,
    ) -> Result<InitializeResult, ErrorData> {
        ctx.peer.set_peer_info(request.clone());
        self.bind_project(&ctx).await?;
        let _ = self.session_identity.set(self.identity(&ctx));
        self.heartbeat(&ctx).await?;
        self.negotiate_initialize(&request)
    }
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().enable_resources().enable_prompts().build()).with_server_info(Implementation::new("jam-board",env!("CARGO_PKG_VERSION"))).with_instructions("This connection is pinned to one project at initialization; get_session_context identifies it. Switching projects in the app never retargets this session. Plan your game jam with your AI teammates. Use task keys such as JB-12. Ready describes planning, not execution authority. Check get_execution for the story: a human must explicitly Start the story or epic before any new work. The appointed brain may request_execution for exact-scope approval in the app Inbox; generic questions and chat text cannot grant authority. Never launch agent sessions merely because a request was created. When a scope is running, claim a Ready task before working, then submit_report with results and test evidence. Pause blocks new work but preserves in-flight reports. A separate human or appointed brain reviews the report with review_task; never review your own work.")
    }
    async fn list_tools(
        &self,
        _: Option<PaginatedRequestParams>,
        ctx: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, ErrorData> {
        self.heartbeat(&ctx).await?;
        Ok(ListToolsResult {
            tools: tools(),
            ..Default::default()
        })
    }
    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        ctx: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, ErrorData> {
        let (name, client) = self.identity(&ctx);
        let this = self.clone();
        let tool_name = request.name.to_string();
        let record_name = tool_name.clone();
        let args = Value::Object(request.arguments.unwrap_or_default());
        let result = tokio::task::spawn_blocking(move || {
            let actor = this.session_store()?.identify_agent(&name, &client)?;
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
                let code = match &e {
                    jam_core::Error::NotFound(_) => "not_found",
                    jam_core::Error::ClaimConflict { .. } => "claim_conflict",
                    jam_core::Error::NotReady(_) => "not_ready",
                    jam_core::Error::ExecutionRequired(_) => "execution_required",
                    jam_core::Error::WrongStatus(_) => "wrong_status",
                    jam_core::Error::Forbidden(_) => "forbidden",
                    jam_core::Error::Archived(_) => "archived",
                    jam_core::Error::Conflict => "conflict",
                    _ => "validation",
                };
                let message = e.to_string();
                let mut r =
                    CallToolResult::error(vec![ContentBlock::text(format!("{code}: {message}"))]);
                let mut data = json!({"code":code,"message":message});
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
        let store = self.session_store().map_err(internal)?;
        let uri = request.uri;
        let text = tokio::task::spawn_blocking({
            let uri = uri.clone();
            move || -> jam_core::Result<String> {
                if uri == "jam://board" {
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
                    md.push_str("\n## Waiting as a brain\nRecover with list_changes_since at turn start, then call wait_for_changes (timeoutSeconds=60) for reports, answers and human edits. Handle events, save nextCursor even on timeout, and repeat. With epicKey, includeProject=true also observes project-wide human events.\n");
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
                        Some(vec![PromptArgument::new("tag").with_required(false)])
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
        let mut instruction = crate::v2::prompt(&request.name)
            .ok_or_else(|| ErrorData::invalid_params("Unknown prompt", None))?;
        if let Some(tag) = request
            .arguments
            .and_then(|a| a.get("tag").and_then(|v| v.as_str()).map(str::to_owned))
        {
            instruction.push_str(&format!(" Filter tasks by tag={}", json!(tag)));
        }
        Ok(GetPromptResult::new(vec![PromptMessage::new_text(Role::User, instruction)]).into())
    }
}

fn summary(name: &str, v: &Value) -> String {
    let key = v["key"].as_str().unwrap_or("");
    let title = v["title"].as_str().unwrap_or("");
    match name {
        "create_task" => format!(
            "Created {key} '{title}' in {}.",
            v["status"].as_str().unwrap_or("backlog")
        ),
        "claim_task" => format!("Claimed {key} '{title}'."),
        "move_task" => format!("Moved {key} to {}.", v["status"].as_str().unwrap_or("")),
        "get_task" | "update_task" => format!("{key} · {title}"),
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
    pub key: String,
}
#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Move {
    key: String,
    status: String,
    before_key: Option<String>,
    after_key: Option<String>,
    override_reason: Option<String>,
}
#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct Release {
    key: String,
    status: Option<String>,
}
#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct AddComment {
    key: String,
    body: String,
}
#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct Archive {
    key: String,
    reason: Option<String>,
}
#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct Assets {
    kind: Option<String>,
    query: Option<String>,
}
