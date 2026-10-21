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
