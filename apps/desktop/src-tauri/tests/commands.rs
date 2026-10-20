use jam_board_lib::commands::{ApiError, MoveInput};
use jam_core::{CreateTask, Error, TaskEditInput};

#[test]
fn command_inputs_reject_a_frontend_actor() {
    assert!(serde_json::from_value::<TaskEditInput>(serde_json::json!({"key":"JB-1","expectedUpdatedAt":"v1","actor":"codex","title":"No impersonation"})).is_err());
    let patch: TaskEditInput=serde_json::from_value(serde_json::json!({"key":"JB-1","expectedUpdatedAt":"v1","estimate":null,"assigneeId":null})).unwrap();
    assert_eq!(patch.patch.estimate, Some(None));
    assert_eq!(patch.patch.assignee_id, Some(None));
    assert_eq!(patch.patch.due_at, None);
    assert!(
        serde_json::from_value::<CreateTask>(serde_json::json!({
            "title":"A task", "actor":"codex"
        }))
        .is_err()
    );
    assert!(
        serde_json::from_value::<MoveInput>(serde_json::json!({
            "key":"JB-1", "status":"done", "actor":"codex"
        }))
        .is_err()
    );
}

#[test]
fn domain_errors_keep_the_public_command_contract() {
    for (error, code) in [
        (Error::NotFound("JB-404".into()), "not_found"),
        (
            Error::ClaimConflict {
                holder: "Claude".into(),
            },
            "claim_conflict",
        ),
        (
            Error::Validation {
                field: "title".into(),
                reason: "Required".into(),
            },
            "validation",
        ),
        (Error::Archived("JB-1".into()), "archived"),
        (Error::Conflict, "conflict"),
        (Error::Io(std::io::Error::other("Unavailable")), "internal"),
    ] {
        let result = serde_json::to_value(ApiError::from(error)).unwrap();
        assert_eq!(result["code"], code);
        assert!(!result["message"].as_str().unwrap().is_empty());
        if code == "validation" {
            assert_eq!(result["field"], "title");
        }
    }
}
