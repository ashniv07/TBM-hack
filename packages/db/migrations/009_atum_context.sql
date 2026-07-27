-- Stage 6 improvement: retain the row context used to make each mapping.
alter table atum_mappings add column if not exists source_context jsonb;
