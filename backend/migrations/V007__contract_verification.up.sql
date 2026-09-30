-- Contract source and bytecode verification records.
CREATE TABLE IF NOT EXISTS contract_verification (
    id TEXT PRIMARY KEY,
    contract_id TEXT NOT NULL,
    network TEXT NOT NULL,
    source_code TEXT NOT NULL,
    source_hash TEXT NOT NULL,
    dependencies TEXT NOT NULL DEFAULT '{}',
    metadata TEXT NOT NULL DEFAULT '{}',
    wasm_hash TEXT,
    on_chain_wasm_hash TEXT,
    status TEXT NOT NULL CHECK (status IN ('pending', 'verified', 'mismatch', 'failed')),
    error_code TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    verified_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_contract_verification_contract
    ON contract_verification (contract_id, network, updated_at);
CREATE INDEX IF NOT EXISTS idx_contract_verification_status
    ON contract_verification (status, updated_at);
