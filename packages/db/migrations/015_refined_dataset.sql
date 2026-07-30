-- Migration 015: Add refined_path to datasets
-- The refined_path stores the path to a dataset containing only mapped columns
-- with template column names (output of the Relationship phase for Data Quality input)

ALTER TABLE datasets ADD COLUMN IF NOT EXISTS refined_path text;

COMMENT ON COLUMN datasets.refined_path IS 'Path to refined Excel file with only mapped columns and template column names';
