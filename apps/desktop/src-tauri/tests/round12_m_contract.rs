use jam_core::*;
use serde_json::json;
#[test]
fn moodboard_and_inbox_inputs_reject_actor_forgery_and_keep_nullable_feedback() {
    let input: ReferenceVerdictInput =
        serde_json::from_value(json!({"itemId":"item","verdictNote":null})).unwrap();
    assert!(input.verdict.is_none());
    assert_eq!(input.verdict_note, Some(None));
    for input in [
        json!({"frameId":"frame","actor":"agent"}),
        json!({"frameId":"frame","force":true}),
    ] {
        assert!(serde_json::from_value::<SendReferenceReviewInput>(input).is_err());
    }
    assert!(
        serde_json::from_value::<InboxEventsQuery>(json!({"filter":"needs_action","limit":50}))
            .is_ok()
    );
    assert!(serde_json::from_value::<InboxEventsQuery>(json!({"actor":"other"})).is_err());
    assert!(
        serde_json::from_value::<CollectKeptInput>(
            json!({"requestId":"collect","sourceFrameIds":["frame"],"actor":"other"})
        )
        .is_err()
    );
}
