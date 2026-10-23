-- A claim generation is a freshness validator, not execution authority or a lease.
ALTER TABLE tasks ADD COLUMN claim_generation INTEGER NOT NULL DEFAULT 0 CHECK(claim_generation >= 0);
CREATE TRIGGER tasks_advance_claim_generation
AFTER UPDATE OF status, assignee_id, review_round ON tasks
WHEN NEW.status IS NOT OLD.status
  OR NEW.assignee_id IS NOT OLD.assignee_id
  OR NEW.review_round IS NOT OLD.review_round
BEGIN
  SELECT CASE WHEN OLD.claim_generation = 9223372036854775807
    THEN RAISE(ABORT, 'claim generation exhausted') END;
  UPDATE tasks SET claim_generation = OLD.claim_generation + 1 WHERE id = NEW.id;
END;
