use jam_board_lib::commands::{ApiError, ApiErrorCode};
use jam_core::*;
use serde_json::json;

#[test]
fn planning_inputs_never_accept_a_frontend_actor() {
    assert!(serde_json::from_value::<NewEpic>(json!({"title":"Lantern","actor":"agent"})).is_err());
    assert!(
        serde_json::from_value::<BriefEditInput>(
            json!({"key":"JB-1","goalMd":"Clear goal","actor":"agent"})
        )
        .is_err()
    );
    assert!(
        serde_json::from_value::<AnswerQuestion>(
            json!({"id":"question","answerText":"Yes","answeredBy":"agent"})
        )
        .is_err()
    );
    assert!(
        serde_json::from_value::<ReviewTask>(
            json!({"key":"JB-1","verdict":"accept","commentsMd":"Checked","reviewerId":"agent"})
        )
        .is_err()
    );
    let missing: ApiError = Error::NotReady("goal: Goal is empty".into()).into();
    assert!(matches!(missing.code, ApiErrorCode::NotReady));
    let forbidden: ApiError = Error::Forbidden("Only humans may answer".into()).into();
    assert!(matches!(forbidden.code, ApiErrorCode::Forbidden));
}

#[test]
fn report_and_review_commands_require_caller_captured_context_without_actor_flags() {
    let report = json!({"key":"JB-1","expectedClaimGeneration":"task:1","summaryMd":"Evidence","changedFiles":[],"tests":[]});
    assert!(serde_json::from_value::<SubmitReport>(report.clone()).is_ok());
    let review = json!({"key":"JB-1","expectedReportId":"report-id","expectedReviewContextRevision":"opaque-context","verdict":"accept","commentsMd":"Checked"});
    assert!(serde_json::from_value::<ReviewTask>(review.clone()).is_ok());
    for field in ["expectedReportId", "expectedReviewContextRevision"] {
        let mut missing = review.clone();
        missing.as_object_mut().unwrap().remove(field);
        assert!(serde_json::from_value::<ReviewTask>(missing).is_err());
    }
    let mut missing = report.clone();
    missing
        .as_object_mut()
        .unwrap()
        .remove("expectedClaimGeneration");
    assert!(serde_json::from_value::<SubmitReport>(missing).is_err());
    for field in [
        "actor",
        "reviewerId",
        "userApproved",
        "force",
        "ignoreVersion",
    ] {
        let mut forged = review.clone();
        forged[field] = json!("forged");
        assert!(serde_json::from_value::<ReviewTask>(forged).is_err());
        let mut forged = report.clone();
        forged[field] = json!("forged");
        assert!(serde_json::from_value::<SubmitReport>(forged).is_err());
    }
}
