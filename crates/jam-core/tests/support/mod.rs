//! Explicit test-only human grants for scenarios whose subject is not authorization.
#![allow(dead_code)]
use jam_core::*;
pub fn start_story(store: &Store, human: &str, id: &str) {
    let scope = ExecutionScope {
        kind: ExecutionScopeType::Story,
        id: id.into(),
    };
    let expected_revision = store.get_execution(&scope).unwrap().revision;
    store
        .set_execution(
            human,
            SetExecution {
                scope,
                action: ExecutionAction::Start,
                expected_revision,
            },
        )
        .unwrap();
}
pub fn start_epic(store: &Store, human: &str, id: &str) {
    let scope = ExecutionScope {
        kind: ExecutionScopeType::Epic,
        id: id.into(),
    };
    let expected_revision = store.get_execution(&scope).unwrap().revision;
    store
        .set_execution(
            human,
            SetExecution {
                scope,
                action: ExecutionAction::Start,
                expected_revision,
            },
        )
        .unwrap();
}
