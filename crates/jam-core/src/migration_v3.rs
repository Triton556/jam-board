use rusqlite::{Transaction, params};

pub(crate) fn migrate(tx: &Transaction<'_>) -> rusqlite_migration::HookResult {
    let jams=tx.prepare("SELECT j.id,j.key_prefix,min(t.created_by),count(*),sum(t.status='todo') FROM jams j JOIN tasks t ON t.jam_id=j.id GROUP BY j.id")?
        .query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,i64>(3)?,r.get::<_,i64>(4)?)))?
        .collect::<std::result::Result<Vec<_>,_>>()?;
    for (jam, prefix, actor, count, todo) in jams {
        let epic = crate::id();
        let story = crate::id();
        let stamp = crate::now();
        tx.execute("INSERT INTO epics(id,jam_id,key,title,color,status,goal_md,done_when_md,position,created_by,updated_by,created_at,updated_at) VALUES (?,?,?,'Imported tasks','m1','active','Tasks created before epics existed.','Every imported task is done or archived.',1024,?,?,?,?)",params![epic,jam,format!("{prefix}-E1"),actor,actor,stamp,stamp])?;
        tx.execute("INSERT INTO stories(id,jam_id,key,epic_id,title,status,outcome_md,acceptance_json,position,created_by,updated_by,created_at,updated_at) VALUES (?,?,?,?,'Imported tasks','active','Keep working on tasks created before stories existed.',?,1024,?,?,?,?)",params![story,jam,format!("{prefix}-S1"),epic,r#"[{"id":"1","criterion":"All imported tasks are done or archived.","mandatory":true,"check":"Inspect all non-archived task statuses."}]"#,actor,actor,stamp,stamp])?;
        tx.execute("UPDATE jams SET epic_seq=1,story_seq=1 WHERE id=?", [&jam])?;
        tx.execute("INSERT INTO tasks_v3(id,jam_id,key,title,description_md,status,priority,estimate,due_at,position,assignee_id,created_by,updated_by,created_at,updated_at,archived_at,idempotency_key,story_id) SELECT id,jam_id,key,title,description_md,CASE status WHEN 'todo' THEN 'backlog' ELSE status END,priority,estimate,due_at,position,assignee_id,created_by,updated_by,created_at,updated_at,archived_at,idempotency_key,? FROM tasks WHERE jam_id=?",params![story,jam])?;
        tx.execute("INSERT INTO activity(id,jam_id,actor_id,action,payload,created_at,epic_id) VALUES (?,?,?,'epic.created',?,?,?)",params![crate::id(),jam,actor,serde_json::json!({"key":format!("{prefix}-E1"),"title":"Imported tasks","movedTasks":count,"todoToBacklog":todo,"migration":true}).to_string(),stamp,epic])?;
    }
    // The copy is transactional. All original task identities, content and links survive.
    tx.execute_batch("DROP TABLE tasks; ALTER TABLE tasks_v3 RENAME TO tasks; CREATE INDEX tasks_column ON tasks(jam_id,status,position); CREATE INDEX tasks_assignee ON tasks(assignee_id); CREATE INDEX tasks_story ON tasks(story_id,status);
    UPDATE activity SET epic_id=(SELECT s.epic_id FROM tasks t JOIN stories s ON s.id=t.story_id WHERE t.id=activity.task_id) WHERE task_id IS NOT NULL;")?;
    Ok(())
}
