use serde_json::{Value, json};

fn walk_properties(value: &Value, path: &str, missing: &mut Vec<String>) {
    match value {
        Value::Object(object) => {
            if let Some(properties) = object.get("properties").and_then(Value::as_object) {
                for (name, schema) in properties {
                    if !schema["description"]
                        .as_str()
                        .is_some_and(|d| !d.trim().is_empty())
                    {
                        missing.push(format!("{path}.{name}"));
                    }
                }
            }
            for (key, child) in object {
                walk_properties(child, &format!("{path}.{key}"), missing);
            }
        }
        Value::Array(values) => {
            for (i, value) in values.iter().enumerate() {
                walk_properties(value, &format!("{path}[{i}]"), missing);
            }
        }
        _ => {}
    }
}

fn choices(schema: &Value, root: &Value, result: &mut Vec<Value>) {
    if let Some(reference) = schema["$ref"].as_str() {
        choices(
            root.pointer(reference.strip_prefix('#').unwrap()).unwrap(),
            root,
            result,
        );
    }
    if let Some(values) = schema["enum"].as_array() {
        result.extend(values.iter().filter(|v| !v.is_null()).cloned());
    }
    if let Some(value) = schema.get("const")
        && !value.is_null()
    {
        result.push(value.clone());
    }
    for keyword in ["anyOf", "oneOf", "allOf"] {
        if let Some(values) = schema[keyword].as_array() {
            for value in values {
                choices(value, root, result);
            }
        }
    }
    if let Some(items) = schema.get("items") {
        choices(items, root, result);
    }
}

#[test]
fn every_tool_input_property_has_a_description() {
    let mut missing = vec![];
    for tool in jam_mcp::tool_catalog() {
        walk_properties(
            &serde_json::to_value(tool.input_schema).unwrap(),
            tool.name.as_ref(),
            &mut missing,
        );
    }
    assert!(
        missing.is_empty(),
        "Missing descriptions: {}",
        missing.join(", ")
    );
}

#[test]
fn planning_and_task_inputs_derive_exact_enum_values() {
    let tools = jam_mcp::tool_catalog();
    for (tool_name, field, expected) in [
        (
            "create_epic",
            "color",
            json!(["m1", "m2", "m3", "m4", "m5", "m6"]),
        ),
        (
            "update_epic",
            "color",
            json!(["m1", "m2", "m3", "m4", "m5", "m6"]),
        ),
        (
            "create_epic",
            "participation",
            json!(["each_iteration", "first_sketch", "autonomous"]),
        ),
        (
            "create_epic",
            "reviewer",
            json!(["none", "final", "stages"]),
        ),
        (
            "set_epic_status",
            "status",
            json!(["draft", "active", "done", "archived"]),
        ),
        (
            "set_story_status",
            "status",
            json!(["draft", "active", "done", "archived"]),
        ),
        (
            "create_task",
            "status",
            json!(["backlog", "ready", "in_progress", "review", "done"]),
        ),
        (
            "list_tasks",
            "status",
            json!(["backlog", "ready", "in_progress", "review", "done"]),
        ),
        (
            "create_task",
            "priority",
            json!(["low", "medium", "high", "critical"]),
        ),
        (
            "update_task",
            "priority",
            json!(["low", "medium", "high", "critical"]),
        ),
        ("create_task", "estimate", json!([1, 2, 3, 5, 8])),
        ("update_task", "estimate", json!([1, 2, 3, 5, 8])),
    ] {
        let tool = tools.iter().find(|t| t.name == tool_name).unwrap();
        let schema = serde_json::to_value(&tool.input_schema).unwrap();
        let mut actual = vec![];
        choices(&schema["properties"][field], &schema, &mut actual);
        assert_eq!(
            actual,
            expected.as_array().unwrap().clone(),
            "{tool_name}.{field}"
        );
    }
}
