use jam_core::*;

#[test]
fn every_error_code_has_one_protocol_prefix() {
    let mut db = rusqlite::Connection::open_in_memory().unwrap();
    let storage = db
        .execute("SELECT missing_column FROM missing_table", [])
        .unwrap_err();
    let migration =
        rusqlite_migration::Migrations::new(vec![rusqlite_migration::M::up("INVALID SQL")])
            .to_latest(&mut db)
            .unwrap_err();
    let cases = vec![
        ("already_undone", Error::AlreadyUndone("fixture".into())),
        (
            "in_use",
            Error::InUse {
                usage: Box::new(AssetUsage::default()),
            },
        ),
        (
            "idempotency_conflict",
            Error::IdempotencyConflict("requestId fixture conflicts".into()),
        ),
        (
            "execution_required",
            Error::ExecutionRequired("Human must Start".into()),
        ),
        ("not_ready", Error::NotReady("Missing brief".into())),
        (
            "wrong_status",
            Error::WrongStatus("Task is in review".into()),
        ),
        (
            "forbidden",
            Error::Forbidden("forbidden: forbidden: Fixture".into()),
        ),
        ("not_found", Error::NotFound("Fixture".into())),
        (
            "claim_conflict",
            Error::ClaimConflict {
                holder: "Fixture".into(),
            },
        ),
        (
            "validation",
            Error::Validation {
                field: "color".into(),
                reason: "unknown variant m7".into(),
            },
        ),
        ("archived", Error::Archived("Fixture".into())),
        ("stale_claim", Error::StaleClaim),
        ("conflict", Error::Conflict),
        ("storage", Error::Storage(storage)),
        ("migration", Error::Migration(migration)),
        (
            "io",
            Error::Io(std::io::Error::new(std::io::ErrorKind::NotFound, "Fixture")),
        ),
        (
            "data",
            Error::Json(serde_json::from_str::<serde_json::Value>("{").unwrap_err()),
        ),
    ];
    for (code, error) in cases {
        assert_eq!(error.code(), code);
        let message = error.protocol_message();
        assert!(message.starts_with(&format!("{code}: ")));
        assert_eq!(message.matches(&format!("{code}:")).count(), 1, "{message}");
        if code == "validation" {
            assert_eq!(message, "validation: color: unknown variant m7");
        }
    }
}
