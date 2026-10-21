use jam_core::activity_sentence;
use serde_json::json;

#[test]
fn review_sentence_does_not_invent_failed_tests_when_only_comments_are_given() {
    assert_eq!(
        activity_sentence(
            "review.recorded",
            "Test operator",
            Some("JB-1"),
            &json!({"verdict": "changes_requested", "failedTests": []})
        ),
        "Test operator returned JB-1 for changes"
    );
    assert_eq!(
        activity_sentence(
            "review.recorded",
            "Brain",
            Some("JB-1"),
            &json!({"verdict": "changes_requested", "failedTests": ["2", "4"]})
        ),
        "Brain returned JB-1: tests 2 and 4 failed"
    );
    assert_eq!(
        activity_sentence(
            "review.recorded",
            "Brain",
            Some("JB-1"),
            &json!({"verdict": "accept", "failedTests": []})
        ),
        "Brain accepted JB-1"
    );
}
