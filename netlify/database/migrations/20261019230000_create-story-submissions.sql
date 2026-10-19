-- Copies of "Tell your story" submissions for the /inbox page (form fields only, no IP address or browser).
CREATE TABLE story_submissions (
  id TEXT PRIMARY KEY,
  received_at TIMESTAMPTZ NOT NULL,
  fields JSONB NOT NULL
);

CREATE INDEX story_submissions_received_at ON story_submissions (received_at DESC);
