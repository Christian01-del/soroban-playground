-- SQLite schema for the Soroban indexer (dev / test / single-node default).
-- Mirrors migrations/postgres/001-005 and is applied automatically by
-- SqliteDatabase::new via sqlx::migrate!.

CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    contract_id TEXT NOT NULL,
    ledger INTEGER NOT NULL,
    ledger_closed_at TEXT NOT NULL,
    event_type TEXT NOT NULL,
    data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_contract_id ON events(contract_id);
CREATE INDEX IF NOT EXISTS idx_events_ledger ON events(ledger DESC);

CREATE TABLE IF NOT EXISTS oracles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    reputation INTEGER DEFAULT 100,
    active BOOLEAN DEFAULT TRUE,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS quorums (
    id TEXT PRIMARY KEY,
    quorum_type TEXT NOT NULL,
    state TEXT NOT NULL,
    strategy TEXT NOT NULL,
    threshold INTEGER NOT NULL,
    target_id TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_quorums_state ON quorums(state);

CREATE TABLE IF NOT EXISTS votes (
    id TEXT PRIMARY KEY,
    quorum_id TEXT NOT NULL REFERENCES quorums(id),
    oracle_id TEXT NOT NULL REFERENCES oracles(id),
    choice TEXT NOT NULL,
    data TEXT,
    timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(quorum_id, oracle_id)
);
CREATE INDEX IF NOT EXISTS idx_votes_quorum_id ON votes(quorum_id);

CREATE TABLE IF NOT EXISTS audit_trail (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    actor TEXT NOT NULL,
    payload TEXT NOT NULL,
    prev_hash TEXT NOT NULL,
    entry_hash TEXT NOT NULL,
    merkle_root TEXT NOT NULL,
    timestamp TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_trail(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_event_type ON audit_trail(event_type);

CREATE TABLE IF NOT EXISTS ledgers (
    sequence INTEGER PRIMARY KEY,
    ledger_hash TEXT NOT NULL,
    parent_ledger_hash TEXT NOT NULL,
    ingested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ledgers_ledger_hash ON ledgers(ledger_hash);

CREATE TABLE IF NOT EXISTS ledger_reorgs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rolled_back_from INTEGER NOT NULL,
    detected_at_sequence INTEGER NOT NULL,
    ledgers_removed INTEGER NOT NULL,
    events_removed INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
