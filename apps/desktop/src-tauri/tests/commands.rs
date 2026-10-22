use jam_board_lib::commands::{ApiError, MoveInput};
use jam_core::{CreateTask, Error, ReleaseClaim, TaskEditInput};

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
        (Error::StaleClaim, "stale_claim"),
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

#[test]
fn release_claim_input_requires_a_version_and_cannot_choose_actor_or_destination() {
    let valid = serde_json::json!({"key":"JB-1","expectedUpdatedAt":"opaque-version"});
    let input: ReleaseClaim = serde_json::from_value(valid.clone()).unwrap();
    assert_eq!(input.expected_updated_at, "opaque-version");
    for (field, value) in [
        ("actor", "agent"),
        ("status", "done"),
        ("assigneeId", "other"),
        ("projectId", "other-project"),
    ] {
        let mut forged = valid.clone();
        forged[field] = serde_json::json!(value);
        assert!(
            serde_json::from_value::<ReleaseClaim>(forged).is_err(),
            "unexpected field {field}"
        );
    }
    assert!(serde_json::from_value::<ReleaseClaim>(serde_json::json!({"key":"JB-1"})).is_err());
    for (error, code) in [
        (Error::Conflict, "conflict"),
        (Error::WrongStatus("No claim".into()), "wrong_status"),
        (Error::Forbidden("Human only".into()), "forbidden"),
    ] {
        assert_eq!(
            serde_json::to_value(ApiError::from(error)).unwrap()["code"],
            code
        );
    }
}

#[test]
fn native_move_and_ready_require_captured_task_version_without_authority_flags() {
    use jam_core::ReadyInput;
    let move_input =
        serde_json::json!({"key":"JB-1","status":"ready","expectedUpdatedAt":"captured-version"});
    let ready_input = serde_json::json!({"key":"JB-1","expectedUpdatedAt":"captured-version","overrideReason":"Explicit human reason"});
    assert_eq!(
        serde_json::from_value::<MoveInput>(move_input.clone())
            .unwrap()
            .expected_updated_at,
        "captured-version"
    );
    assert_eq!(
        serde_json::from_value::<ReadyInput>(ready_input.clone())
            .unwrap()
            .expected_updated_at,
        "captured-version"
    );
    for field in [
        "actor",
        "humanId",
        "projectId",
        "force",
        "ignoreVersion",
        "expectedClaimGeneration",
    ] {
        let mut forged = move_input.clone();
        forged[field] = serde_json::json!("forged");
        assert!(
            serde_json::from_value::<MoveInput>(forged).is_err(),
            "MoveInput.{field}"
        );
        let mut forged = ready_input.clone();
        forged[field] = serde_json::json!("forged");
        assert!(
            serde_json::from_value::<ReadyInput>(forged).is_err(),
            "ReadyInput.{field}"
        );
    }
    let mut missing = move_input;
    missing.as_object_mut().unwrap().remove("expectedUpdatedAt");
    assert!(serde_json::from_value::<MoveInput>(missing).is_err());
    let mut missing = ready_input;
    missing.as_object_mut().unwrap().remove("expectedUpdatedAt");
    assert!(serde_json::from_value::<ReadyInput>(missing).is_err());
}
