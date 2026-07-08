CREATE EXTENSION IF NOT EXISTS vector;

CREATE TYPE complaint_status AS ENUM ('pending', 'matched', 'new_report_created');

CREATE TABLE processed_reports (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  structured_report jsonb NOT NULL,
  canonical_summary text NOT NULL,
  summary_vector    vector(:EMBEDDING_DIM) NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  match_count       integer NOT NULL DEFAULT 0
);

CREATE TABLE raw_complaints (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_text            text NOT NULL,
  received_at         timestamptz NOT NULL DEFAULT now(),
  input_vector        vector(:EMBEDDING_DIM),
  processed_report_id uuid REFERENCES processed_reports(id),
  status              complaint_status NOT NULL DEFAULT 'pending'
);

CREATE INDEX processed_reports_summary_vector_hnsw
  ON processed_reports USING hnsw (summary_vector vector_cosine_ops);
