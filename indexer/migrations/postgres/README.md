# Indexer PostgreSQL Migrations

These DDL files are managed by the **Rust/sqlx indexer** (`indexer/`) and are
completely separate from the Node.js backend's Knex migration system.

## Why they are separate

| Dimension        | Backend (Node.js)                          | Indexer (Rust)                        |
|------------------|--------------------------------------------|---------------------------------------|
| Runtime          | Node.js                                    | Rust                                  |
| Migration tool   | [Knex](https://knexjs.org/)                | [sqlx](https://docs.rs/sqlx)          |
| Config location  | `backend/knexfile.js`                      | Rust `DATABASE_URL` env var           |
| Migration files  | `backend/src/database/migrations/*.js`     | `indexer/migrations/postgres/*.sql`   |
| Applied by       | `knex migrate:latest`                      | `sqlx migrate run` (or startup code)  |
| Dialect          | SQLite (dev/test) + PostgreSQL (prod)       | PostgreSQL only                       |

## Files in this directory

| File                       | Description                                                      |
|----------------------------|------------------------------------------------------------------|
| `001_initial_schema.sql`   | Core `events` table — contract events ingested from Soroban RPC  |
| `002_quorum_system.sql`    | `oracles`, `quorums`, `votes` tables for the quorum engine       |
| `003_audit_trail.sql`      | `audit_trail` table for the append-only tamper-evident log       |
| `004_ledger_reorg.sql`     | `ledgers` table — hash chain used for fork detection             |
| `005_ledger_reorgs.sql`    | `ledger_reorgs` — log of every reorg rollback                    |

The SQLite backend (default for dev/test) uses the equivalent schema in
`../sqlite/`, which is applied automatically on connect.

## Running the indexer migrations

```bash
# Set the database URL
export DATABASE_URL="postgres://user:password@localhost:5432/soroban_indexer"

# Apply all pending migrations with the sqlx CLI (from the repo root)
sqlx migrate run --source indexer/migrations/postgres --database-url "$DATABASE_URL"
```

## Do NOT use Knex to manage these files

The backend's `knex migrate:latest` command is unaware of these files and will
never touch them.  Merging these schemas into the Knex pipeline would require
rewriting the Rust indexer to use a Node.js connection — that is outside the
scope of this project.

## Schema overview

```
events              ← Soroban contract events (contract_id, ledger, data)
oracles             ← Registered oracle nodes
quorums             ← Consensus sessions (bridge, oracle, governance)
votes               ← Individual oracle votes on a quorum
audit_trail         ← Tamper-evident log (merkle-chained hashes)
ledgers             ← Ledger hash chain (sequence, hash, parent hash)
ledger_reorgs       ← Rollbacks performed by reorg::ReorgHandler
```
