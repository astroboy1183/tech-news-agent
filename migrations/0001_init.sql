-- v0.1.0 — initial schema.
-- Migrations are forward-only and additive: production applies them before the
-- new Worker version goes live, so every change must be safe against the
-- previous version still serving traffic.

-- ── sources ─────────────────────────────────────────────────────────────────
CREATE TABLE sources (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  name                 TEXT    NOT NULL,
  homepage             TEXT,
  feed_url             TEXT    NOT NULL UNIQUE,
  kind                 TEXT    NOT NULL DEFAULT 'rss',   -- rss | atom | jsonfeed | hn | reddit | github | arxiv
  section              TEXT    NOT NULL,                 -- default hint; the classifier decides per article
  weight               REAL    NOT NULL DEFAULT 1.0,     -- 0.3–2.0, moved by the preference pass
  active               INTEGER NOT NULL DEFAULT 1,
  tier                 TEXT    NOT NULL DEFAULT 'B',     -- A 2–5m · B 15m · C 1h · D 6–24h
  poll_interval        INTEGER NOT NULL DEFAULT 900,     -- seconds
  next_poll_at         INTEGER NOT NULL DEFAULT 0,       -- unix seconds
  websub_hub           TEXT,
  websub_state         TEXT,
  etag                 TEXT,
  last_modified        TEXT,
  content_hash         TEXT,
  last_fetched_at      INTEGER,
  last_status          TEXT,
  items_per_day        REAL    NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  created_at           INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_sources_due     ON sources (active, next_poll_at);
CREATE INDEX idx_sources_section ON sources (section, active);

-- ── clusters ────────────────────────────────────────────────────────────────
CREATE TABLE clusters (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  primary_article_id INTEGER,
  headline           TEXT,
  section            TEXT    NOT NULL,
  source_count       INTEGER NOT NULL DEFAULT 1,
  first_seen_at      INTEGER NOT NULL,
  last_seen_at       INTEGER NOT NULL,
  velocity           REAL    NOT NULL DEFAULT 0,   -- sources per hour
  score              REAL    NOT NULL DEFAULT 0,
  created_at         INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_clusters_score   ON clusters (score DESC, last_seen_at DESC);
CREATE INDEX idx_clusters_section ON clusters (section, score DESC);

-- ── articles ────────────────────────────────────────────────────────────────
CREATE TABLE articles (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  url_canonical    TEXT    NOT NULL,
  url_hash         TEXT    NOT NULL UNIQUE,        -- sha256 of the canonical url
  source_id        INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  cluster_id       INTEGER REFERENCES clusters(id) ON DELETE SET NULL,
  title            TEXT    NOT NULL,               -- normalised on ingest
  title_raw        TEXT,                           -- exactly as the feed gave it
  badge            TEXT,                           -- lifted prefixes: EXCLUSIVE, ANALYSIS
  author           TEXT,
  excerpt          TEXT,
  image_url        TEXT,
  published_at     INTEGER,
  fetched_at       INTEGER NOT NULL,
  section          TEXT    NOT NULL,
  topics_json      TEXT    NOT NULL DEFAULT '[]',
  heuristic_score  REAL    NOT NULL DEFAULT 0,
  engagement_score REAL    NOT NULL DEFAULT 0,
  status           TEXT    NOT NULL DEFAULT 'live' -- live | enriched
);
CREATE INDEX idx_articles_feed     ON articles (fetched_at DESC);
CREATE INDEX idx_articles_section  ON articles (section, fetched_at DESC);
CREATE INDEX idx_articles_pending  ON articles (status, heuristic_score DESC);
CREATE INDEX idx_articles_cluster  ON articles (cluster_id);
CREATE INDEX idx_articles_source   ON articles (source_id, fetched_at DESC);

-- ── enrichments ─────────────────────────────────────────────────────────────
-- Keyed by cluster: one Claude call covers every member, which is what makes
-- the budget work.
CREATE TABLE enrichments (
  cluster_id      INTEGER PRIMARY KEY REFERENCES clusters(id) ON DELETE CASCADE,
  summary         TEXT    NOT NULL,
  why_it_matters  TEXT,
  topics_json     TEXT    NOT NULL DEFAULT '[]',
  section         TEXT,
  excerpt_used    TEXT    NOT NULL,   -- what the summary was written from, for checking
  model           TEXT    NOT NULL,
  tokens_in       INTEGER NOT NULL DEFAULT 0,
  tokens_out      INTEGER NOT NULL DEFAULT 0,
  cost_micros     INTEGER NOT NULL DEFAULT 0,
  batch           INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ── front page and digests ──────────────────────────────────────────────────
CREATE TABLE digests (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  date         TEXT    NOT NULL,
  section      TEXT,
  intro        TEXT,
  status       TEXT    NOT NULL DEFAULT 'draft',
  published_at INTEGER,
  UNIQUE (date, section)
);

CREATE TABLE digest_items (
  digest_id  INTEGER NOT NULL REFERENCES digests(id) ON DELETE CASCADE,
  cluster_id INTEGER NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
  slot       TEXT    NOT NULL,   -- lead | hero | across | section | latest
  rank       INTEGER NOT NULL,
  PRIMARY KEY (digest_id, cluster_id)
);

-- A pinned lead overrides the five gates for a fixed window.
CREATE TABLE pins (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  cluster_id INTEGER NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ── learning loop ───────────────────────────────────────────────────────────
CREATE TABLE feedback (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER REFERENCES articles(id) ON DELETE CASCADE,
  cluster_id INTEGER REFERENCES clusters(id) ON DELETE CASCADE,
  signal     TEXT    NOT NULL,   -- up | down | save | click
  origin     TEXT    NOT NULL,   -- web | slack | email
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_feedback_recent ON feedback (created_at DESC);

CREATE TABLE preferences (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  doc_json   TEXT    NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ── operations ──────────────────────────────────────────────────────────────
CREATE TABLE runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  stage       TEXT    NOT NULL,
  started_at  INTEGER NOT NULL,
  ended_at    INTEGER,
  counts_json TEXT    NOT NULL DEFAULT '{}',
  error       TEXT
);
CREATE INDEX idx_runs_stage ON runs (stage, started_at DESC);

CREATE TABLE deliveries (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  digest_id  INTEGER REFERENCES digests(id) ON DELETE CASCADE,
  channel    TEXT    NOT NULL,
  target     TEXT,
  status     TEXT    NOT NULL,
  error      TEXT,
  sent_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE subscribers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT    NOT NULL UNIQUE,
  sections_json TEXT  NOT NULL DEFAULT '[]',
  verified    INTEGER NOT NULL DEFAULT 0,
  unsub_token TEXT    NOT NULL UNIQUE,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ── full-text search ────────────────────────────────────────────────────────
-- Written now rather than later: backfilling an FTS index over a populated
-- table is far more painful than carrying the triggers from the start.
CREATE VIRTUAL TABLE articles_fts USING fts5 (
  title,
  excerpt,
  content='articles',
  content_rowid='id',
  tokenize="porter unicode61"
);

CREATE TRIGGER articles_ai AFTER INSERT ON articles BEGIN
  INSERT INTO articles_fts (rowid, title, excerpt) VALUES (new.id, new.title, new.excerpt);
END;

CREATE TRIGGER articles_ad AFTER DELETE ON articles BEGIN
  INSERT INTO articles_fts (articles_fts, rowid, title, excerpt)
  VALUES ('delete', old.id, old.title, old.excerpt);
END;

CREATE TRIGGER articles_au AFTER UPDATE ON articles BEGIN
  INSERT INTO articles_fts (articles_fts, rowid, title, excerpt)
  VALUES ('delete', old.id, old.title, old.excerpt);
  INSERT INTO articles_fts (rowid, title, excerpt) VALUES (new.id, new.title, new.excerpt);
END;
