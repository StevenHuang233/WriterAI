export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  synopsis TEXT NOT NULL DEFAULT '',
  global_summary TEXT NOT NULL DEFAULT '',
  style_note TEXT NOT NULL DEFAULT '',
  style_profile TEXT NOT NULL DEFAULT '',
  style_profile_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chapters (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  summary_brief TEXT NOT NULL DEFAULT '',
  summary_micro TEXT NOT NULL DEFAULT '',
  summary_locked INTEGER NOT NULL DEFAULT 0,
  summarized_len INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chapters_project ON chapters(project_id, sort_order);

CREATE TABLE IF NOT EXISTS lore_entries (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('character','location','item','faction','world','other')),
  name TEXT NOT NULL,
  aliases TEXT NOT NULL DEFAULT '[]',
  content TEXT NOT NULL DEFAULT '',
  current_state TEXT NOT NULL DEFAULT '',
  always_on INTEGER NOT NULL DEFAULT 0,
  priority INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lore_project ON lore_entries(project_id);

CREATE TABLE IF NOT EXISTS project_context_settings (
  project_id TEXT PRIMARY KEY,
  disabled_blocks TEXT NOT NULL DEFAULT '[]',
  excluded_chapters TEXT NOT NULL DEFAULT '[]',
  pinned_chapters TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS character_profiles (
  lore_id TEXT PRIMARY KEY REFERENCES lore_entries(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  gender TEXT NOT NULL DEFAULT '',
  age TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT '',
  appearance TEXT NOT NULL DEFAULT '',
  personality TEXT NOT NULL DEFAULT '',
  motivation TEXT NOT NULL DEFAULT '',
  catchphrase TEXT NOT NULL DEFAULT '',
  avatar TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_profiles_project ON character_profiles(project_id);

CREATE TABLE IF NOT EXISTS character_relations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  a_lore_id TEXT NOT NULL REFERENCES lore_entries(id) ON DELETE CASCADE,
  b_lore_id TEXT NOT NULL REFERENCES lore_entries(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_relations_project ON character_relations(project_id);

CREATE TABLE IF NOT EXISTS character_state_history (
  id TEXT PRIMARY KEY,
  lore_id TEXT NOT NULL REFERENCES lore_entries(id) ON DELETE CASCADE,
  chapter_id TEXT NOT NULL DEFAULT '',
  chapter_title TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_state_history ON character_state_history(lore_id, created_at DESC);

CREATE TABLE IF NOT EXISTS chapter_snapshots (
  id TEXT PRIMARY KEY,
  chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snapshots_chapter ON chapter_snapshots(chapter_id, created_at DESC);

-- 远段合段压缩：把连续的若干章压缩成一段话（避免远段被单章上限切碎）
CREATE TABLE IF NOT EXISTS chapter_segments (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  size INTEGER NOT NULL,
  start_order INTEGER NOT NULL,
  end_order INTEGER NOT NULL,
  chapter_ids TEXT NOT NULL DEFAULT '[]',
  text TEXT NOT NULL DEFAULT '',
  source_hash TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, size, start_order)
);
CREATE INDEX IF NOT EXISTS idx_segments_project ON chapter_segments(project_id, size);

CREATE TABLE IF NOT EXISTS writing_stats (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  day TEXT NOT NULL,
  delta INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stats_project_day ON writing_stats(project_id, day);

CREATE TABLE IF NOT EXISTS suggestion_logs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('accepted','partial','dismissed')),
  latency_ms INTEGER,
  created_at INTEGER NOT NULL
);
`
