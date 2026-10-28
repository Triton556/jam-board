//! Provider and ACP failures share a stable, non-secret dock classification.
use crate::*;
use serde_json::Value;

#[derive(Debug)]
pub(crate) struct ProviderFailure {
    pub code: AgentErrorCode,
    pub retryable: bool,
    pub retry_after_ms: Option<u64>,
    pub resets_at: Option<String>,
    pub detail: String,
}
impl From<AgentError> for ProviderFailure {
    fn from(error: AgentError) -> Self {
        Self {
            code: AgentErrorCode::Provider,
            retryable: false,
            retry_after_ms: None,
            resets_at: None,
            detail: error.to_string(),
        }
    }
}
impl ProviderFailure {
    pub fn network(message: &str) -> Self {
        Self {
            code: AgentErrorCode::Network,
            retryable: true,
            retry_after_ms: None,
            resets_at: None,
            detail: message.into(),
        }
    }
    pub fn title(&self) -> &'static str {
        match self.code {
            AgentErrorCode::UsageLimit => "Usage limit reached",
            AgentErrorCode::RateLimited => "Rate limit reached",
            AgentErrorCode::Overloaded => "The model is busy right now",
            AgentErrorCode::Auth => "Check the API key or sign in",
            AgentErrorCode::ContextTooLong => "The conversation is too long for this model",
            AgentErrorCode::Network => "Can't reach the provider",
            AgentErrorCode::Provider => "The provider could not complete the request",
            AgentErrorCode::Agent => "The agent could not complete the request",
        }
    }
}
fn number(value: &Value, keys: &[&str]) -> Option<u64> {
    match value {
        Value::Object(map) => keys
            .iter()
            .find_map(|k| {
                map.get(*k)
                    .and_then(|v| v.as_u64().or_else(|| v.as_str()?.parse().ok()))
            })
            .or_else(|| map.values().find_map(|v| number(v, keys))),
        Value::Array(values) => values.iter().find_map(|v| number(v, keys)),
        _ => None,
    }
}
fn readable(value: &Value) -> String {
    match value {
        Value::String(text) => {
            if (text.starts_with('{') || text.starts_with('['))
                && let Ok(nested) = serde_json::from_str::<Value>(text)
            {
                return readable(&nested);
            }
            text.clone()
        }
        Value::Object(values) => values
            .iter()
            .map(|(key, value)| format!("{key}: {}", readable(value)))
            .collect::<Vec<_>>()
            .join("; "),
        Value::Array(values) => values.iter().map(readable).collect::<Vec<_>>().join("; "),
        _ => value.to_string(),
    }
}
pub(crate) fn classify(
    status: Option<u16>,
    body: &Value,
    retry_after: Option<&str>,
    fallback: AgentErrorCode,
) -> ProviderFailure {
    let status = status.or_else(|| {
        number(
            body,
            &["status", "statusCode", "status_code", "code", "http_status"],
        )
        .and_then(|v| u16::try_from(v).ok())
        .filter(|v| (400..=599).contains(v))
    });
    // Decode nested provider JSON before redaction; escaped credential strings must
    // not bypass the session's literal secret filter in the Details field.
    let detail = readable(body);
    let text = detail.to_ascii_lowercase().replace(['_', '-'], " ");
    let has = |terms: &[&str]| terms.iter().any(|term| text.contains(term));
    let usage_limit = has(&[
        "usagelimitexceeded",
        "usage limit",
        "quota exhausted",
        "quota exceeded",
        "insufficient quota",
        "exceeded your current quota",
        "credit balance",
    ]) || (fallback == AgentErrorCode::Agent && has(&["rate limit reached"]));
    let code = if matches!(status, Some(401 | 403)) {
        AgentErrorCode::Auth
    } else if usage_limit {
        AgentErrorCode::UsageLimit
    } else if status == Some(413)
        || has(&[
            "context length",
            "context window",
            "context too long",
            "maximum context",
            "too many tokens",
            "prompt is too long",
            "input too long",
        ])
    {
        AgentErrorCode::ContextTooLong
    } else if status == Some(429) {
        AgentErrorCode::RateLimited
    } else if matches!(status, Some(503 | 529))
        || has(&[
            "at capacity",
            "overloaded",
            "over capacity",
            "capacity exceeded",
            "model is busy",
        ])
    {
        AgentErrorCode::Overloaded
    } else if has(&[
        "rate limit",
        "rate exceeded",
        "too many requests",
        "quota exceeded",
    ]) {
        AgentErrorCode::RateLimited
    } else if has(&[
        "authentication",
        "unauthorized",
        "invalid api key",
        "auth required",
        "not authenticated",
        "sign in",
        "login required",
    ]) {
        AgentErrorCode::Auth
    } else if has(&[
        "network",
        "connection reset",
        "connection refused",
        "timed out",
        "timeout",
        "stream disconnected",
    ]) {
        AgentErrorCode::Network
    } else {
        fallback
    };
    let retryable = matches!(
        code,
        AgentErrorCode::RateLimited | AgentErrorCode::Overloaded | AgentErrorCode::Network
    ) || (code == AgentErrorCode::Provider
        && status.is_some_and(|s| (500..=599).contains(&s)));
    let retry_after_ms = retry_after
        .and_then(parse_retry_after)
        .or_else(|| number(body, &["retryAfterMs", "retry_after_ms"]))
        .or_else(|| number(body, &["retryAfter", "retry_after"]).map(|n| n.saturating_mul(1000)));
    ProviderFailure {
        code,
        retryable,
        retry_after_ms,
        resets_at: (code == AgentErrorCode::UsageLimit)
            .then(|| reset_date(body, &detail))
            .flatten(),
        detail: match status {
            Some(status) => format!("HTTP {status}: {detail}"),
            None => detail,
        },
    }
}
fn reset_date(body: &Value, detail: &str) -> Option<String> {
    match body {
        Value::Object(map) => {
            for key in ["resetsAt", "resets_at", "reset_at"] {
                if let Some(value) = map.get(key) {
                    if let Some(seconds) = value.as_i64() {
                        return time::OffsetDateTime::from_unix_timestamp(seconds)
                            .ok()?
                            .format(&time::format_description::well_known::Rfc3339)
                            .ok();
                    }
                    if let Some(text) = value.as_str()
                        && let Ok(date) = time::OffsetDateTime::parse(
                            text,
                            &time::format_description::well_known::Rfc3339,
                        )
                    {
                        return date
                            .format(&time::format_description::well_known::Rfc3339)
                            .ok();
                    }
                }
            }
            if let Some(date) = map.values().find_map(|v| reset_date(v, "")) {
                return Some(date);
            }
        }
        Value::Array(array) => {
            if let Some(date) = array.iter().find_map(|v| reset_date(v, "")) {
                return Some(date);
            }
        }
        _ => {}
    }
    let lower = detail.to_ascii_lowercase();
    let start = ["try again at ", "resets at ", "resets on "]
        .iter()
        .find_map(|marker| lower.find(marker).map(|at| at + marker.len()))?;
    let words: Vec<_> = detail[start..].split_whitespace().take(6).collect();
    let month = match words.first()?.to_ascii_lowercase().as_str() {
        "jan" | "january" => 1,
        "feb" | "february" => 2,
        "mar" | "march" => 3,
        "apr" | "april" => 4,
        "may" => 5,
        "jun" | "june" => 6,
        "jul" | "july" => 7,
        "aug" | "august" => 8,
        "sep" | "september" => 9,
        "oct" | "october" => 10,
        "nov" | "november" => 11,
        "dec" | "december" => 12,
        _ => return None,
    };
    let day = words
        .get(1)?
        .chars()
        .take_while(char::is_ascii_digit)
        .collect::<String>()
        .parse()
        .ok()?;
    let year = words.get(2)?.trim_end_matches(',').parse().ok()?;
    let (hour, minute) = words.get(3)?.split_once(':')?;
    let mut hour: u8 = hour.parse().ok()?;
    let minute: u8 = minute.parse().ok()?;
    let period = words
        .get(4)?
        .trim_end_matches(['.', ',', ';'])
        .to_ascii_lowercase();
    if !(1..=12).contains(&hour) || !matches!(period.as_str(), "am" | "pm") {
        return None;
    }
    hour %= 12;
    if period == "pm" {
        hour += 12;
    }
    let date =
        time::Date::from_calendar_date(year, time::Month::try_from(month).ok()?, day).ok()?;
    time::Time::from_hms(hour, minute, 0).ok()?;
    // Adapter prose has no timezone. Preserve a local ISO 8601 date rather than
    // inventing a UTC offset; RFC3339 provider dates above keep their offset.
    Some(format!("{date}T{hour:02}:{minute:02}:00"))
}
pub(crate) fn parse_retry_after(value: &str) -> Option<u64> {
    let value = value.trim();
    if let Ok(seconds) = value.parse::<u64>() {
        return Some(seconds.saturating_mul(1000));
    }
    let date =
        time::OffsetDateTime::parse(value, &time::format_description::well_known::Rfc2822).ok()?;
    let delay = (date - time::OffsetDateTime::now_utc())
        .whole_milliseconds()
        .max(0);
    u64::try_from(delay).ok()
}
pub(crate) fn acp_failure(error: &agent_client_protocol::Error) -> ProviderFailure {
    let body = serde_json::to_value(error)
        .unwrap_or_else(|_| serde_json::json!({"message":error.to_string()}));
    let mut failure = classify(None, &body, None, AgentErrorCode::Agent);
    if error.code == agent_client_protocol::schema::v1::ErrorCode::AuthRequired {
        failure.code = AgentErrorCode::Auth;
        failure.retryable = false;
    }
    failure
}
pub(crate) fn emit_failure(session: &crate::session::Session, failure: ProviderFailure) {
    {
        let mut inner = session.inner.lock().expect("session lock");
        inner.last_turn_failed = true;
        inner.last_failure_code = Some(failure.code);
    }
    session.emit(AgentEventKind::Error {
        code: Some(failure.code),
        retryable: failure.retryable,
        retry_after_ms: failure.retry_after_ms,
        resets_at: failure.resets_at.clone(),
        message: failure.title().into(),
        detail: Some(failure.detail),
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn b9_recorded_usage_limit_payloads_are_not_retryable_and_keep_reset_date() {
        let recorded = json!({"code":-32603,"data":{"codexErrorInfo":"usageLimitExceeded"},"message":"You've hit your usage limit. Upgrade to Pro or try again at Nov 2nd, 2026 4:27 PM."});
        let failure = classify(None, &recorded, Some("1"), AgentErrorCode::Agent);
        assert_eq!(failure.code, AgentErrorCode::UsageLimit);
        assert!(!failure.retryable);
        assert_eq!(failure.resets_at.as_deref(), Some("2026-11-02T16:27:00"));
        for (status, body) in [
            (None, json!({"message":"usage limit reached"})),
            (
                Some(429),
                json!({"error":{"type":"insufficient_quota","message":"You exceeded your current quota"}}),
            ),
            (None, json!({"error":{"raw":recorded.to_string()}})),
        ] {
            let failure = classify(status, &body, None, AgentErrorCode::Provider);
            assert_eq!(failure.code, AgentErrorCode::UsageLimit);
            assert!(!failure.retryable);
        }
        let dated = classify(
            Some(429),
            &json!({"error":{"code":"quota_exhausted","resetsAt":"2026-11-02T16:27:00+10:00"}}),
            None,
            AgentErrorCode::Provider,
        );
        assert_eq!(
            dated.resets_at.as_deref(),
            Some("2026-11-02T16:27:00+10:00")
        );
        let transient = classify(
            Some(429),
            &json!({"error":{"code":"rate_limit_exceeded","message":"Too many requests"}}),
            Some("1"),
            AgentErrorCode::Provider,
        );
        assert_eq!(transient.code, AgentErrorCode::RateLimited);
        assert!(transient.retryable);
        let claude = classify(
            None,
            &json!({"message":"Rate limit reached. Try again later"}),
            None,
            AgentErrorCode::Agent,
        );
        assert_eq!(claude.code, AgentErrorCode::UsageLimit);
        assert!(!claude.retryable);
        let invalid = classify(
            None,
            &json!({"message":"usage limit; try again at Nov 32nd, 2026 4:27 PM."}),
            None,
            AgentErrorCode::Agent,
        );
        assert!(invalid.resets_at.is_none());
    }
    #[test]
    fn classification_table_covers_http_and_provider_error_shapes() {
        for (status, body, expected, retryable) in [
            (
                Some(429),
                json!({"error":{"message":"Limit","code":"rate_limit_exceeded"}}),
                AgentErrorCode::RateLimited,
                true,
            ),
            (
                Some(503),
                json!({"error":{"type":"server_error"}}),
                AgentErrorCode::Overloaded,
                true,
            ),
            (Some(529), json!("Busy"), AgentErrorCode::Overloaded, true),
            (
                Some(400),
                json!({"error":{"message":"Model is at capacity"}}),
                AgentErrorCode::Overloaded,
                true,
            ),
            (
                Some(400),
                json!({"error":{"metadata":{"raw":"overloaded_error"}}}),
                AgentErrorCode::Overloaded,
                true,
            ),
            (
                Some(400),
                json!({"error":{"code":"context_length_exceeded","message":"Reduce messages"}}),
                AgentErrorCode::ContextTooLong,
                false,
            ),
            (
                Some(413),
                json!("large"),
                AgentErrorCode::ContextTooLong,
                false,
            ),
            (Some(401), json!("capacity"), AgentErrorCode::Auth, false),
            (Some(403), json!("forbidden"), AgentErrorCode::Auth, false),
            (
                None,
                json!({"error":{"code":429,"message":"Please wait"}}),
                AgentErrorCode::RateLimited,
                true,
            ),
            (
                None,
                json!({"error":{"message":"rate limit reached"}}),
                AgentErrorCode::RateLimited,
                true,
            ),
            (
                None,
                json!({"message":"Network timeout"}),
                AgentErrorCode::Network,
                true,
            ),
            (
                Some(500),
                json!({"error":{"message":"Internal error"}}),
                AgentErrorCode::Provider,
                true,
            ),
            (
                Some(400),
                json!({"error":{"message":"Unsupported model"}}),
                AgentErrorCode::Provider,
                false,
            ),
        ] {
            let actual = classify(status, &body, None, AgentErrorCode::Provider);
            assert_eq!(
                (actual.code, actual.retryable),
                (expected, retryable),
                "{body}"
            );
        }
    }
    #[test]
    fn retry_after_seconds_dates_and_nested_acp_error_data() {
        assert_eq!(parse_retry_after(" 7 "), Some(7000));
        assert_eq!(parse_retry_after("not a date"), None);
        assert_eq!(parse_retry_after("-1"), None);
        assert_eq!(parse_retry_after("Wed, 21 Oct 2015 07:28:00 GMT"), Some(0));
        let future = time::OffsetDateTime::now_utc() + time::Duration::seconds(15);
        let date = future
            .format(&time::format_description::well_known::Rfc2822)
            .unwrap();
        let delay = parse_retry_after(&date).unwrap();
        assert!((13_000..=15_000).contains(&delay));
        let failure = classify(
            None,
            &json!({"error":{"data":{"retryAfterMs":1234},"message":"at capacity"}}),
            Some("3"),
            AgentErrorCode::Agent,
        );
        assert_eq!(failure.retry_after_ms, Some(3000));
        use agent_client_protocol::schema::v1 as a;
        let error = a::Error::internal_error()
            .data(json!({"status":529,"retryAfterMs":1234,"message":"overloaded"}));
        let failure = acp_failure(&error);
        assert_eq!(failure.code, AgentErrorCode::Overloaded);
        assert_eq!(failure.retry_after_ms, Some(1234));
        let error = a::Error::auth_required();
        assert_eq!(acp_failure(&error).code, AgentErrorCode::Auth);
        assert_eq!(
            acp_failure(&a::Error::internal_error()).code,
            AgentErrorCode::Agent
        );
    }
}

#[cfg(test)]
mod redaction_tests {
    use super::*;
    #[test]
    fn provider_detail_decodes_escaped_json_before_secret_redaction_and_reads_old_events() {
        let mut s = std::sync::Arc::try_unwrap(crate::tests::session(SessionStatus::Ready))
            .ok()
            .unwrap();
        let secret = "fictional\"credential";
        s.secrets.push(secret.into());
        let body = serde_json::json!({"error":{"metadata":{"raw":serde_json::json!({"message":format!("at capacity {secret}")}).to_string()}}});
        emit_failure(
            &s,
            classify(Some(400), &body, None, AgentErrorCode::Provider),
        );
        assert!(
            !serde_json::to_string(&crate::tests::events(&s))
                .unwrap()
                .contains("fake-secret-for-tests")
        );
        let saved = crate::tests::events(&s);
        let AgentEventKind::Error {
            detail: Some(detail),
            ..
        } = &saved[0].event
        else {
            panic!("missing error detail");
        };
        assert!(detail.contains("[REDACTED]"));
        assert!(!detail.contains("fictional"));
        let old: AgentEventKind =
            serde_json::from_value(serde_json::json!({"kind":"error","message":"Old error"}))
                .unwrap();
        assert!(matches!(
            old,
            AgentEventKind::Error {
                code: None,
                retryable: false,
                retry_after_ms: None,
                ..
            }
        ));
    }
}
