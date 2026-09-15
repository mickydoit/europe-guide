-- One row per stored object.
--
-- The outbox replays an attachment upload as (storage upload, row insert), and both halves
-- must be safe to repeat: a half-finished attempt, or a queued op that lands after the live
-- write already did, otherwise leaves two rows pointing at the same file. `replay` and
-- `useAttachments.upload` both already treat 23505 as success — this is the constraint that
-- makes that true rather than hopeful.

-- Duplicates first, keeping the earliest row for each path (its id is what the app cached).
delete from attachments a using attachments b where a.storage_path = b.storage_path and a.id > b.id;

create unique index if not exists attachments_storage_path_key on attachments (storage_path);
