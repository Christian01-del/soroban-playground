use anyhow::Result;
use axum::{routing::get, Router};
use soroban_indexer::db::{create_db, Database, DbType, Event};
use soroban_indexer::ws::{
    get_audit_trail, get_oracles, get_quorum, health_handler, post_audit_log, post_vote,
    verify_audit, ws_handler, AppState, BROADCAST_CAPACITY,
};
use soroban_indexer::{graphql, reorg};
use std::sync::Arc;
use tokio::sync::broadcast;
use tower_http::cors::CorsLayer;
use tracing::info;

use async_graphql::http::{playground_source, GraphQLPlaygroundConfig};
use async_graphql_axum::{GraphQLRequest, GraphQLResponse, GraphQLSubscription};
use axum::response::{Html, IntoResponse};

// ── GraphQL Handlers ─────────────────────────────────────────────────────────

async fn graphql_handler(
    schema: axum::extract::Extension<graphql::AppSchema>,
    headers: axum::http::HeaderMap,
    req: GraphQLRequest,
) -> GraphQLResponse {
    let mut req = req.into_inner();
    if let Some(auth) = headers.get("authorization") {
        if let Ok(auth_str) = auth.to_str() {
            if auth_str.starts_with("Bearer ") {
                let role = auth_str.trim_start_matches("Bearer ");
                req = req.data(graphql::auth::UserRole(role.to_string()));
            }
        }
    }
    schema.execute(req).await.into()
}

async fn graphql_playground() -> impl IntoResponse {
    Html(playground_source(
        GraphQLPlaygroundConfig::new("/api/graphql").subscription_endpoint("/api/graphql/ws"),
    ))
}

async fn graphql_sdl(schema: axum::extract::Extension<graphql::AppSchema>) -> impl IntoResponse {
    schema.sdl()
}

// ── DualWriter ────────────────────────────────────────────────────────────────

pub struct DualWriter {
    primary: Arc<dyn Database>,
    secondary: Option<Arc<dyn Database>>,
    /// Broadcast sender — fires after every successful primary write.
    /// `send` is non-blocking and returns `SendError` when there are zero
    /// receivers; we intentionally discard that error.
    broadcaster: broadcast::Sender<Event>,
}

impl DualWriter {
    pub fn new(
        primary: Arc<dyn Database>,
        secondary: Option<Arc<dyn Database>>,
        broadcaster: broadcast::Sender<Event>,
    ) -> Self {
        Self {
            primary,
            secondary,
            broadcaster,
        }
    }

    pub async fn save_event(&self, event: &Event) -> Result<()> {
        self.primary.save_event(event).await?;

        if let Some(ref sec) = self.secondary {
            // Log error but don't fail the primary write.
            if let Err(e) = sec.save_event(event).await {
                tracing::error!("DualWrite secondary write failed: {}", e);
            }
        }

        // Best-effort broadcast. SendError fires when zero clients are connected
        // — that is expected and not an error condition.
        let _ = self.broadcaster.send(event.clone());

        Ok(())
    }
}

// ── Entry point ───────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() -> Result<()> {
    // Structured logging — level controlled by RUST_LOG env var.
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();

    dotenv::dotenv().ok();

    info!("Soroban Indexer starting…");

    // ── Database setup ────────────────────────────────────────────────────────

    let db_type = std::env::var("DB_TYPE").unwrap_or_else(|_| "sqlite".to_string());
    let db_url =
        std::env::var("DATABASE_URL").unwrap_or_else(|_| "sqlite://indexer.db".to_string());

    let primary = create_db(
        if db_type == "postgres" {
            DbType::Postgres
        } else {
            DbType::Sqlite
        },
        &db_url,
    )
    .await?;

    info!("Connected to primary database: {}", db_type);

    let secondary_url = std::env::var("SECONDARY_DATABASE_URL").ok();
    let secondary = if let Some(url) = secondary_url {
        info!("Dual-write mode enabled.");
        Some(create_db(DbType::Postgres, &url).await?)
    } else {
        None
    };

    // ── Broadcast channel ─────────────────────────────────────────────────────

    // The channel is created here and threaded into both DualWriter (sender)
    // and AppState (sender clone for the WS handler to subscribe from).
    let (tx, _) = broadcast::channel::<Event>(BROADCAST_CAPACITY);

    let writer = Arc::new(DualWriter::new(primary.clone(), secondary, tx.clone()));

    // ── Gap recovery worker ──────────────────────────────────────────────────
    // Periodically scans for missing ledger sequences and reports gaps for
    // asynchronous backfill.
    tokio::spawn(gap_recovery_worker(primary.clone(), 60));
    let reorg_handler = Arc::new(reorg::ReorgHandler::new(primary.clone()));

    // ── GraphQL Setup ─────────────────────────────────────────────────────────
    let schema = graphql::build_schema(primary.clone(), tx.clone()).finish();

    // ── WebSocket / HTTP server ───────────────────────────────────────────────

    let ws_port = std::env::var("WS_PORT")
        .unwrap_or_else(|_| "3001".to_string())
        .parse::<u16>()
        .unwrap_or(3001);

    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], ws_port));
    let app_state = AppState::new(primary.clone(), tx.clone()).await?;

    let app = Router::new()
        .route("/ws/events", get(ws_handler))
        .route("/health", get(health_handler))
        .route("/api/quorums/{id}", get(get_quorum))
        .route("/api/quorums/{id}/vote", axum::routing::post(post_vote))
        .route("/api/oracles", get(get_oracles))
        .route("/api/audit", get(get_audit_trail))
        .route("/api/audit/log", axum::routing::post(post_audit_log))
        .route("/api/audit/verify", axum::routing::post(verify_audit))
        .route("/api/graphql", axum::routing::post(graphql_handler))
        .route("/graphiql", get(graphql_playground))
        .route(
            "/api/graphql/ws",
            axum::routing::any_service(GraphQLSubscription::new(schema.clone())),
        )
        .route("/api/graphql/sdl", get(graphql_sdl))
        .layer(axum::Extension(schema))
        .layer(CorsLayer::permissive()) // tighten to specific origins in production
        .with_state(app_state);

    info!(
        "WebSocket server listening on ws://0.0.0.0:{}/ws/events",
        ws_port
    );

    let listener = tokio::net::TcpListener::bind(addr).await?;

    // Run the HTTP server concurrently with the indexer loop.
    tokio::select! {
        result = axum::serve(listener, app) => {
            if let Err(e) = result {
                tracing::error!("HTTP server error: {}", e);
            }
        }
        result = indexer_loop(writer, reorg_handler) => {
            if let Err(e) = result {
                tracing::error!("Indexer loop error: {}", e);
            }
        }
    }

    Ok(())
}

// ── Gap recovery ─────────────────────────────────────────────────────────────
// Fork detection and rollback live in `reorg::ReorgHandler`; this worker only
// reports sequences that still need backfilling (including those left behind
// by a rollback).

/// Background worker that periodically scans for missing ledger sequences and
/// reports gaps so ingest can backfill them asynchronously.
pub async fn gap_recovery_worker(db: Arc<dyn Database>, interval_secs: u64) {
    loop {
        match db.find_ledger_gaps().await {
            Ok(gaps) if !gaps.is_empty() => {
                for (start, end) in gaps {
                    info!(
                        "Ledger gap detected: sequences {}..={} (backfill needed)",
                        start, end
                    );
                }
            }
            Ok(_) => info!("Gap recovery check: ledger chain is contiguous."),
            Err(e) => tracing::error!("Gap recovery check failed: {}", e),
        }
        tokio::time::sleep(tokio::time::Duration::from_secs(interval_secs)).await;
    }
}

// ── Indexer loop ──────────────────────────────────────────────────────────────

/// Placeholder for the real event-fetching loop.
/// Replace this with Stellar Horizon / Soroban RPC polling logic.
async fn indexer_loop(_writer: Arc<DualWriter>, _reorg: Arc<reorg::ReorgHandler>) -> Result<()> {
    info!("Indexer loop started (awaiting events from Stellar network)…");

    // In production this loop polls Soroban RPC / Horizon for new ledgers.
    // Each ledger header goes through the reorg handler *before* its events
    // are written, so events are never attached to an orphaned ledger. The
    // broadcast fires automatically inside save_event().
    //
    // Example:
    //   let (header, events) = fetch_next_ledger_from_rpc().await?;
    //   match reorg.ingest(&header, &rpc).await? {
    //       IngestOutcome::Duplicate => continue,
    //       IngestOutcome::Reorg(r) => resume_from = r.rolled_back_from,
    //       IngestOutcome::Appended | IngestOutcome::Gap { .. } => {}
    //   }
    //   for event in events { writer.save_event(&event).await?; }

    loop {
        tokio::time::sleep(tokio::time::Duration::from_secs(60)).await;
        info!("Indexer loop heartbeat — waiting for RPC integration");
    }
}
