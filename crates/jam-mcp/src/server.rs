use jam_core::{CreateTask, Member, Store, TaskFilter, UpdateTask};
use rmcp::{ErrorData, RoleServer, ServerHandler, model::*, service::RequestContext};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RecentCall {
    pub at: String,
    pub error: Option<String>,
    pub agent: String,
    pub tool: String,
    pub ok: bool,
}
pub type RecentCalls = Arc<Mutex<std::collections::VecDeque<RecentCall>>>;

#[derive(Clone)]
pub struct JamServer {
    store: Arc<Store>,
    agent_name: Option<String>,
    recent: RecentCalls,
    report_stdio: bool,
}
impl JamServer {
    pub fn new(store: Arc<Store>, agent_name: Option<String>, recent: RecentCalls) -> Self {
        Self {
            store,
            agent_name,
            recent,
            report_stdio: false,
        }
    }
    pub fn report_stdio_calls(mut self) -> Self {
        self.report_stdio = true;
        self
    }
    fn identity(&self, ctx: &RequestContext<RoleServer>) -> (String, String) {
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
        let store = self.store.clone();
        tokio::task::spawn_blocking(move || store.identify_agent(&name, &client))
            .await
            .map_err(internal)?
            .map_err(internal)
    }
    fn execute(&self, actor: &Member, name: &str, args: Value) -> jam_core::Result<Value> {
        let store = &self.store;
        match name {
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
                value(store.move_task(
                    &actor.id,
                    &a.key,
                    &a.status,
                    a.before_key.as_deref(),
                    a.after_key.as_deref(),
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
fn parse<T: DeserializeOwned>(v: Value) -> jam_core::Result<T> {
    serde_json::from_value(v).map_err(|e| jam_core::Error::Validation {
        field: "arguments".into(),
        reason: e.to_string(),
    })
}
fn value<T: Serialize>(v: T) -> jam_core::Result<Value> {
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
fn tool<T: JsonSchema>(name: &'static str, description: &'static str, read_only: bool) -> Tool {
    let mut input = schema::<T>();
    // Schema hints use the domain's vocabulary; validation still runs in jam-core
    // so invalid tool input becomes isError rather than a JSON-RPC protocol error.
    if let Some(properties) = input.get_mut("properties").and_then(Value::as_object_mut) {
        if let Some(status) = properties.get_mut("status") {
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
        if let Some(priority) = properties.get_mut("priority") {
            let mut choices = jam_core::PRIORITIES
                .iter()
                .map(|s| json!(s))
                .collect::<Vec<_>>();
            choices.push(Value::Null);
            *priority = json!({"type":["string","null"],"enum":choices});
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
        "list_tasks" => Some(schema::<jam_core::TaskPage>()),
        "move_task" | "release_task" | "archive_task" => Some(schema::<jam_core::TaskSummary>()),
        "add_comment" => Some(schema::<jam_core::Comment>()),
        _ => None,
    };
    if let Some(output) = output {
        result.output_schema = Some(Arc::new(output));
    }
    result
}
fn tools() -> Vec<Tool> {
    vec![
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
            "Read a task by its key, for example JB-12, with tags, assets, comments, and the latest 20 activity events.",
            true,
        ),
        tool::<CreateTask>(
            "create_task",
            "Create a task in the active jam; status defaults to todo and priority to medium. Supply idempotencyKey to safely retry without creating duplicates.",
            false,
        ),
        tool::<UpdateTask>(
            "update_task",
            "Edit a task by key; provided tags replace the full tag list. Omit estimate/dueAt to preserve them or pass null to clear them; archived tasks cannot be edited.",
            false,
        ),
        tool::<Move>(
            "move_task",
            "Move a task to a status and optionally between adjacent neighbors. afterKey precedes the moved task and beforeKey follows it; omit both to append.",
            false,
        ),
        tool::<Key>(
            "claim_task",
            "Claim a task for yourself and start it if it is in backlog or todo. A task held by another member returns claim_conflict with the holder's name.",
            false,
        ),
        tool::<Release>(
            "release_task",
            "Release a task you hold and move it to todo or the supplied status. Only the current holder or a human can release it.",
            false,
        ),
        tool::<AddComment>(
            "add_comment",
            "Add a Markdown comment of 1–4000 characters to a task. Use this to summarize work before moving it to review.",
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
    ]
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
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().enable_resources().enable_prompts().build()).with_server_info(Implementation::new("jam-board",env!("CARGO_PKG_VERSION"))).with_instructions("Plan your game jam with your AI teammates. Use task keys such as JB-12; claim before working, comment with results, then move to review.")
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
            let actor = this.store.identify_agent(&name, &client)?;
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
            Err(e) => CallToolResult::error(vec![ContentBlock::text(e.to_string())]),
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
        let store = self.store.clone();
        let uri = request.uri;
        let text=tokio::task::spawn_blocking({let uri=uri.clone();move||->jam_core::Result<String>{
            if uri=="jam://board"{let b=store.board(Some(&actor.id))?;let mut md=format!("# {}\n\nTheme: {}\n\n| Status | Count |\n|---|---|\n",b["jam"]["name"].as_str().unwrap_or("Jam"),b["jam"]["theme"].as_str().unwrap_or("—"));
                if let Some(cols)=b["columns"].as_array(){for col in cols{md.push_str(&format!("| {} | {} |\n",col["status"].as_str().unwrap_or(""),col["count"]));}}md.push_str("\n## In progress\n");if let Some(ts)=b["inProgress"].as_array(){for t in ts{md.push_str(&format!("- {}: {}\n",t["key"].as_str().unwrap_or(""),t["title"].as_str().unwrap_or("")));}}Ok(md)
            }else if let Some(key)=uri.strip_prefix("jam://task/"){let t=store.get_task(key)?;let assignee=t.task.assignee_id.as_deref().map(|id|store.get_member(id)).transpose()?.map(|m|m.name).unwrap_or_else(||"Unassigned".into());
                let mut md=format!("# {} · {}\n\n| Field | Value |\n|---|---|\n| Status | {} |\n| Priority | {} |\n| Assignee | {} |\n| Estimate | {} |\n| Due | {} |\n| Tags | {} |\n\n{}\n\n## Comments\n",t.task.key,t.task.title,t.task.status,t.task.priority,assignee,t.task.estimate.map(|n|n.to_string()).unwrap_or_else(||"—".into()),t.task.due_at.as_deref().unwrap_or("—"),t.task.tags.join(", "),t.task.description_md);
                for comment in t.comments{let author=store.get_member(&comment.author_id)?;md.push_str(&format!("\n### {} · {}\n\n{}\n",author.name,comment.created_at,comment.body_md));}Ok(md)
            }else{Err(jam_core::Error::NotFound(uri))}
        }}).await.map_err(internal)?.map_err(|e|ErrorData::invalid_params(e.to_string(),None))?;
        Ok(ReadResourceResult::new(vec![ResourceContents::text(text, uri)]).into())
    }
    async fn list_prompts(
        &self,
        _: Option<PaginatedRequestParams>,
        ctx: RequestContext<RoleServer>,
    ) -> Result<ListPromptsResult, ErrorData> {
        self.heartbeat(&ctx).await?;
        Ok(ListPromptsResult {
            prompts: vec![Prompt::new(
                "work_on_next_task",
                Some("Claim the highest-priority available task, complete it, and request review."),
                Some(vec![
                    PromptArgument::new("tag")
                        .with_description("Optional tag filter")
                        .with_required(false),
                ]),
            )],
            ..Default::default()
        })
    }
    async fn get_prompt(
        &self,
        request: GetPromptRequestParams,
        ctx: RequestContext<RoleServer>,
    ) -> Result<GetPromptResponse, ErrorData> {
        self.heartbeat(&ctx).await?;
        if request.name != "work_on_next_task" {
            return Err(ErrorData::invalid_params("Unknown prompt", None));
        }
        let tag = request
            .arguments
            .and_then(|a| a.get("tag").and_then(|v| v.as_str()).map(str::to_string));
        let instruction = format!(
            "1. Call get_board.\n2. Call list_tasks with status=[\"todo\"], assignee=\"unassigned\"{}, and paginate to choose the highest-priority task (critical > high > medium > low; ties by board order).\n3. Call claim_task; if claim_conflict occurs, choose another available task.\n4. Perform the work.\n5. Call add_comment with a concise summary and validation.\n6. Call move_task with status=\"review\".",
            tag.map(|s| format!(", tag={}", json!(s)))
                .unwrap_or_default()
        );
        Ok(GetPromptResult::new(vec![PromptMessage::new_text(Role::User, instruction)]).into())
    }
}

fn summary(name: &str, v: &Value) -> String {
    let key = v["key"].as_str().unwrap_or("");
    let title = v["title"].as_str().unwrap_or("");
    match name {
        "create_task" => format!(
            "Created {key} '{title}' in {}.",
            v["status"].as_str().unwrap_or("todo")
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
struct Empty {}
#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct Key {
    key: String,
}
#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Move {
    key: String,
    status: String,
    before_key: Option<String>,
    after_key: Option<String>,
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
