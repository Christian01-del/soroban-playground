-- Append-only log of chain reorganisations handled by reorg::ReorgHandler.
-- Each row is written in the same transaction as the rollback it describes.
CREATE TABLE IF NOT EXISTS ledger_reorgs (
    id BIGSERIAL PRIMARY KEY,
    rolled_back_from BIGINT NOT NULL,
    detected_at_sequence BIGINT NOT NULL,
    ledgers_removed BIGINT NOT NULL,
    events_removed BIGINT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ledger_reorgs_created_at ON ledger_reorgs(created_at DESC);
