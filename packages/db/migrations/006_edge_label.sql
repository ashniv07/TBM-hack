-- Stage 4 improvement: structural (PK/FK) dataset-to-dataset edges need to
-- carry which column produced the match (e.g. "Storage Device ID") so the UI
-- can render "FK(Storage Device ID, 96%)" instead of an unlabeled line.
alter table context_edges add column if not exists label text;
