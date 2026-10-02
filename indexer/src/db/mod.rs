pub mod postgres;
pub mod sqlite;
pub mod trait_;

pub use postgres::PostgresDatabase;
pub use sqlite::SqliteDatabase;
#[allow(unused_imports)] // re-exported for the cfg(test) modules and external consumers
pub use trait_::{AuditEntry, Database, Event, Oracle, Quorum, Vote};

use anyhow::Result;
use std::sync::Arc;

pub enum DbType {
    Sqlite,
    Postgres,
}

pub async fn create_db(db_type: DbType, url: &str) -> Result<Arc<dyn Database>> {
    match db_type {
        DbType::Sqlite => Ok(Arc::new(SqliteDatabase::new(url).await?)),
        DbType::Postgres => Ok(Arc::new(PostgresDatabase::new(url).await?)),
    }
}
