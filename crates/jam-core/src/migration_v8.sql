ALTER TABLE ref_items ADD COLUMN verdict TEXT CHECK(verdict IN ('keep','reject'));
ALTER TABLE ref_items ADD COLUMN archived_by TEXT;
-- Recover historical archive actors only from recorded archive events. A last
-- editor is not necessarily the person who deleted an item; unknown stays NULL.
UPDATE ref_items SET archived_by=(
    SELECT CASE WHEN m.kind='human' THEN 'human' ELSE m.name END
    FROM activity a JOIN members m ON m.id=a.actor_id
    WHERE a.jam_id=ref_items.jam_id AND a.action='reference.updated'
      AND json_extract(a.payload,'$.itemId')=ref_items.id
      AND json_extract(a.payload,'$.archived')=1
    ORDER BY a.seq DESC LIMIT 1
) WHERE archived_at IS NOT NULL;
CREATE TABLE ref_frame_links (
    frame_id TEXT NOT NULL REFERENCES ref_frames(id) ON DELETE CASCADE,
    target_type TEXT NOT NULL CHECK(target_type IN ('epic','story','task')),
    target_id TEXT NOT NULL,
    archived_at TEXT,
    PRIMARY KEY(frame_id,target_type,target_id)
);
