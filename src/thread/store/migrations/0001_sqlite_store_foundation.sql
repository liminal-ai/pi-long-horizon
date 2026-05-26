CREATE TABLE IF NOT EXISTS threads (
  thread_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  source_revision INTEGER NOT NULL,
  message_high_watermark INTEGER NOT NULL,
  turns_revision INTEGER NOT NULL,
  target_runtime TEXT NOT NULL,
  target_session_id TEXT,
  target_session_file_path TEXT,
  current_generated_file_path TEXT,
  thread_json TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS actors (
  thread_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  display_name TEXT,
  actor_json TEXT NOT NULL,
  PRIMARY KEY (thread_id, actor_id),
  FOREIGN KEY (thread_id) REFERENCES threads(thread_id) ON DELETE CASCADE
) STRICT;

CREATE TABLE IF NOT EXISTS messages (
  thread_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  source_order INTEGER NOT NULL,
  source_revision INTEGER NOT NULL,
  actor_id TEXT NOT NULL,
  message_kind TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  target_event_key TEXT,
  message_json TEXT NOT NULL,
  PRIMARY KEY (thread_id, message_id),
  UNIQUE (thread_id, source_order),
  UNIQUE (thread_id, target_event_key),
  FOREIGN KEY (thread_id) REFERENCES threads(thread_id) ON DELETE CASCADE
) STRICT;

CREATE INDEX IF NOT EXISTS idx_messages_thread_source_order
  ON messages(thread_id, source_order);

CREATE TABLE IF NOT EXISTS turns (
  thread_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  turn_order INTEGER NOT NULL,
  lifecycle_status TEXT NOT NULL,
  source_revision INTEGER NOT NULL,
  turn_json TEXT NOT NULL,
  PRIMARY KEY (thread_id, turn_id),
  UNIQUE (thread_id, turn_order),
  FOREIGN KEY (thread_id) REFERENCES threads(thread_id) ON DELETE CASCADE
) STRICT;

CREATE TABLE IF NOT EXISTS chunks (
  thread_id TEXT NOT NULL,
  chunk_id TEXT NOT NULL,
  chunk_position INTEGER NOT NULL,
  lifecycle_status TEXT NOT NULL,
  source_revision INTEGER,
  chunk_json TEXT NOT NULL,
  PRIMARY KEY (thread_id, chunk_id),
  UNIQUE (thread_id, chunk_position),
  FOREIGN KEY (thread_id) REFERENCES threads(thread_id) ON DELETE CASCADE
) STRICT;

CREATE TABLE IF NOT EXISTS imports (
  thread_id TEXT NOT NULL,
  import_id TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  status TEXT NOT NULL,
  import_json TEXT NOT NULL,
  PRIMARY KEY (thread_id, import_id),
  FOREIGN KEY (thread_id) REFERENCES threads(thread_id) ON DELETE CASCADE
) STRICT;

CREATE TABLE IF NOT EXISTS projection_revisions (
  thread_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL,
  generated_file_path TEXT NOT NULL,
  generated_session_id TEXT,
  thread_view_id TEXT,
  projection_json TEXT NOT NULL,
  PRIMARY KEY (thread_id, revision_id),
  FOREIGN KEY (thread_id) REFERENCES threads(thread_id) ON DELETE CASCADE
) STRICT;

CREATE INDEX IF NOT EXISTS idx_projection_revisions_thread_created_at
  ON projection_revisions(thread_id, created_at);
