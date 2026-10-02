//! Ledger reorganisation detection and rollback.
//!
//! Every ingested ledger header is checked for continuity against what is
//! already stored:
//!
//! * the stored header at the same sequence (a different hash means the stored
//!   one was orphaned),
//! * the stored parent at `sequence - 1` (its hash must equal the incoming
//!   `parent_ledger_hash`), and
//! * the stored child at `sequence + 1` when backfilling a gap (its
//!   `parent_ledger_hash` must equal the incoming hash).
//!
//! On a conflict the handler walks backwards, comparing stored hashes with the
//! canonical chain, until it finds the last common ancestor. Everything above
//! the ancestor (ledgers and their events) is deleted in one transaction and
//! the incoming ledger is stored. Walks deeper than `max_depth` are refused
//! without touching the database so a misbehaving RPC node cannot wipe the
//! index.

use crate::db::trait_::{Database, Ledger, RollbackStats};
use anyhow::{bail, Result};
use async_trait::async_trait;
use std::sync::Arc;
use tracing::{info, warn};

/// Default bound on how far back a fork may be before manual intervention is
/// required.
pub const DEFAULT_MAX_REORG_DEPTH: u32 = 64;

/// Source of truth for the canonical chain (e.g. a Soroban RPC node).
#[async_trait]
pub trait CanonicalChain: Send + Sync {
    /// Hash of the canonical ledger at `sequence`, or `None` if unknown.
    async fn ledger_hash(&self, sequence: u32) -> Result<Option<String>>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReorgReport {
    /// Last ledger shared by the stored and canonical chains, if any.
    pub common_ancestor: Option<u32>,
    /// First sequence that was deleted.
    pub rolled_back_from: u32,
    pub stats: RollbackStats,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IngestOutcome {
    /// Stored and contiguous with the previous tip.
    Appended,
    /// Already stored with the same hash; nothing written.
    Duplicate,
    /// Stored, but `from..=to` is missing below it and needs backfilling.
    Gap { from: u32, to: u32 },
    /// A fork was rolled back and the ledger stored on the canonical branch.
    /// Sequences between the ancestor and the ingested ledger must be
    /// re-fetched.
    Reorg(ReorgReport),
}

pub struct ReorgHandler {
    db: Arc<dyn Database>,
    max_depth: u32,
}

impl ReorgHandler {
    pub fn new(db: Arc<dyn Database>) -> Self {
        Self::with_max_depth(db, DEFAULT_MAX_REORG_DEPTH)
    }

    pub fn with_max_depth(db: Arc<dyn Database>, max_depth: u32) -> Self {
        Self { db, max_depth }
    }

    pub async fn ingest(
        &self,
        ledger: &Ledger,
        chain: &dyn CanonicalChain,
    ) -> Result<IngestOutcome> {
        let seq = ledger.sequence;

        match self.find_conflict(ledger).await? {
            Some(conflict) if conflict == seq && self.is_duplicate(ledger).await? => {
                Ok(IngestOutcome::Duplicate)
            }
            Some(conflict) => {
                let report = self.rollback(conflict, seq, chain).await?;
                self.db.insert_ledger(ledger).await?;
                Ok(IngestOutcome::Reorg(report))
            }
            None => {
                let tip = self.db.get_ledger_tip().await?;
                self.db.insert_ledger(ledger).await?;
                match tip {
                    Some(tip) if seq > tip.sequence + 1 => Ok(IngestOutcome::Gap {
                        from: tip.sequence + 1,
                        to: seq - 1,
                    }),
                    _ => Ok(IngestOutcome::Appended),
                }
            }
        }
    }

    async fn is_duplicate(&self, ledger: &Ledger) -> Result<bool> {
        Ok(self
            .db
            .get_ledger(ledger.sequence)
            .await?
            .is_some_and(|stored| stored.ledger_hash == ledger.ledger_hash))
    }

    /// Returns the highest stored sequence that is provably orphaned by
    /// `ledger`, or `None` if it links cleanly into the stored chain. A stored
    /// ledger at the same sequence is reported as a conflict at that sequence
    /// (the caller distinguishes duplicates).
    async fn find_conflict(&self, ledger: &Ledger) -> Result<Option<u32>> {
        let seq = ledger.sequence;

        if let Some(child) = self.db.get_ledger(seq.saturating_add(1)).await? {
            if hashes_differ(&child.parent_ledger_hash, &ledger.ledger_hash) {
                return Ok(Some(seq + 1));
            }
        }
        if self.db.get_ledger(seq).await?.is_some() {
            return Ok(Some(seq));
        }
        if seq > 0 {
            if let Some(parent) = self.db.get_ledger(seq - 1).await? {
                if hashes_differ(&parent.ledger_hash, &ledger.parent_ledger_hash) {
                    return Ok(Some(seq - 1));
                }
            }
        }
        Ok(None)
    }

    /// Walk back from the orphaned ledger at `conflict` to the last common
    /// ancestor and delete everything above it.
    async fn rollback(
        &self,
        conflict: u32,
        detected_at: u32,
        chain: &dyn CanonicalChain,
    ) -> Result<ReorgReport> {
        let mut common_ancestor = None;
        let mut cursor = conflict;

        while let Some(stored) = self.db.get_ledger_below(cursor).await? {
            if conflict - stored.sequence > self.max_depth {
                bail!(
                    "reorg detected at ledger {detected_at} is deeper than {} ledgers; refusing to roll back automatically",
                    self.max_depth
                );
            }
            let Some(canonical) = chain.ledger_hash(stored.sequence).await? else {
                bail!(
                    "canonical chain has no ledger {}; cannot resolve reorg detected at {detected_at}",
                    stored.sequence
                );
            };
            if stored.ledger_hash == canonical {
                common_ancestor = Some(stored.sequence);
                break;
            }
            cursor = stored.sequence;
        }

        // Without an ancestor every stored ledger from `cursor` up is orphaned.
        let rolled_back_from = common_ancestor.map_or(cursor, |a| a + 1);
        warn!(
            detected_at,
            rolled_back_from,
            ?common_ancestor,
            "chain reorganisation detected; rolling back orphaned ledgers"
        );
        let stats = self
            .db
            .rollback_from_ledger(rolled_back_from, detected_at)
            .await?;
        info!(
            ledgers_removed = stats.ledgers_removed,
            events_removed = stats.events_removed,
            "reorg rollback committed"
        );

        Ok(ReorgReport {
            common_ancestor,
            rolled_back_from,
            stats,
        })
    }
}

/// Empty hashes are treated as "unknown" and never signal a fork.
fn hashes_differ(a: &str, b: &str) -> bool {
    !a.is_empty() && !b.is_empty() && a != b
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{Event, SqliteDatabase};
    use std::collections::HashMap;

    /// Canonical chain backed by a map of sequence -> hash.
    struct MockChain(HashMap<u32, String>);

    #[async_trait]
    impl CanonicalChain for MockChain {
        async fn ledger_hash(&self, sequence: u32) -> Result<Option<String>> {
            Ok(self.0.get(&sequence).cloned())
        }
    }

    /// Builds the ledger at `seq` on `branch`. Ledgers below `fork_at` are
    /// shared by every branch.
    fn ledger(branch: &str, seq: u32, fork_at: u32) -> Ledger {
        let name = |s: u32| {
            if s < fork_at {
                format!("main-{s}")
            } else {
                format!("{branch}-{s}")
            }
        };
        Ledger {
            sequence: seq,
            ledger_hash: name(seq),
            parent_ledger_hash: name(seq - 1),
        }
    }

    fn chain(branch: &str, range: std::ops::RangeInclusive<u32>, fork_at: u32) -> MockChain {
        MockChain(
            range
                .map(|s| (s, ledger(branch, s, fork_at).ledger_hash))
                .collect(),
        )
    }

    fn event(seq: u32) -> Event {
        Event {
            id: format!("evt-{seq}"),
            contract_id: "C1".into(),
            ledger: i64::from(seq),
            ledger_closed_at: "2026-01-01T00:00:00Z".into(),
            event_type: "contract".into(),
            data: "{}".into(),
        }
    }

    async fn setup(
        branch: &str,
        range: std::ops::RangeInclusive<u32>,
        fork_at: u32,
    ) -> (Arc<dyn Database>, ReorgHandler) {
        let db: Arc<dyn Database> = Arc::new(SqliteDatabase::new("sqlite::memory:").await.unwrap());
        let handler = ReorgHandler::with_max_depth(db.clone(), 5);
        let canonical = chain(branch, range.clone(), fork_at);
        for seq in range {
            handler
                .ingest(&ledger(branch, seq, fork_at), &canonical)
                .await
                .unwrap();
            db.save_event(&event(seq)).await.unwrap();
        }
        (db, handler)
    }

    async fn stored_hashes(
        db: &Arc<dyn Database>,
        range: std::ops::RangeInclusive<u32>,
    ) -> Vec<Option<String>> {
        let mut out = Vec::new();
        for seq in range {
            out.push(db.get_ledger(seq).await.unwrap().map(|l| l.ledger_hash));
        }
        out
    }

    #[tokio::test]
    async fn appends_contiguous_ledgers() {
        let (db, _) = setup("main", 1..=5, u32::MAX).await;
        assert_eq!(db.get_ledger_tip().await.unwrap().unwrap().sequence, 5);
        assert!(db.find_ledger_gaps().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn same_hash_is_duplicate() {
        let (_, handler) = setup("main", 1..=3, u32::MAX).await;
        let canonical = chain("main", 1..=3, u32::MAX);
        let outcome = handler
            .ingest(&ledger("main", 2, u32::MAX), &canonical)
            .await
            .unwrap();
        assert_eq!(outcome, IngestOutcome::Duplicate);
    }

    #[tokio::test]
    async fn reports_gap_and_accepts_backfill() {
        let (db, handler) = setup("main", 1..=3, u32::MAX).await;
        let canonical = chain("main", 1..=6, u32::MAX);

        let outcome = handler
            .ingest(&ledger("main", 6, u32::MAX), &canonical)
            .await
            .unwrap();
        assert_eq!(outcome, IngestOutcome::Gap { from: 4, to: 5 });
        assert_eq!(db.find_ledger_gaps().await.unwrap(), vec![(4, 5)]);

        for seq in 4..=5 {
            let outcome = handler
                .ingest(&ledger("main", seq, u32::MAX), &canonical)
                .await
                .unwrap();
            assert_eq!(outcome, IngestOutcome::Appended);
        }
        assert!(db.find_ledger_gaps().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn replacement_ledger_at_same_sequence_rolls_back_fork() {
        // Stored: main-1..main-5. Canonical forks at 4: fork-4, fork-5.
        let (db, handler) = setup("main", 1..=5, u32::MAX).await;
        let canonical = chain("fork", 1..=5, 4);

        let outcome = handler
            .ingest(&ledger("fork", 4, 4), &canonical)
            .await
            .unwrap();
        assert_eq!(
            outcome,
            IngestOutcome::Reorg(ReorgReport {
                common_ancestor: Some(3),
                rolled_back_from: 4,
                stats: RollbackStats {
                    ledgers_removed: 2,
                    events_removed: 2,
                },
            })
        );
        assert_eq!(
            stored_hashes(&db, 3..=5).await,
            vec![Some("main-3".into()), Some("fork-4".into()), None]
        );
        // Events from orphaned ledgers are gone; the ancestor's survive.
        assert!(db.get_event("evt-4").await.unwrap().is_none());
        assert!(db.get_event("evt-5").await.unwrap().is_none());
        assert!(db.get_event("evt-3").await.unwrap().is_some());
    }

    #[tokio::test]
    async fn parent_hash_mismatch_walks_back_to_common_ancestor() {
        // Stored: main-1..main-5. Canonical forked at 3; we first hear about it
        // from fork-6, whose parent (fork-5) is not what we stored at 5.
        let (db, handler) = setup("main", 1..=5, u32::MAX).await;
        let canonical = chain("fork", 1..=6, 3);

        let outcome = handler
            .ingest(&ledger("fork", 6, 3), &canonical)
            .await
            .unwrap();
        let IngestOutcome::Reorg(report) = outcome else {
            panic!("expected reorg, got {outcome:?}");
        };
        assert_eq!(report.common_ancestor, Some(2));
        assert_eq!(report.rolled_back_from, 3);
        assert_eq!(report.stats.ledgers_removed, 3);

        // 3..=5 must now be backfilled from the canonical branch.
        assert_eq!(db.find_ledger_gaps().await.unwrap(), vec![(3, 5)]);
        for seq in 3..=5 {
            let outcome = handler
                .ingest(&ledger("fork", seq, 3), &canonical)
                .await
                .unwrap();
            assert_eq!(outcome, IngestOutcome::Appended, "backfilling {seq}");
        }
        assert_eq!(
            stored_hashes(&db, 1..=6).await,
            vec![
                Some("main-1".into()),
                Some("main-2".into()),
                Some("fork-3".into()),
                Some("fork-4".into()),
                Some("fork-5".into()),
                Some("fork-6".into()),
            ]
        );
    }

    #[tokio::test]
    async fn backfill_that_contradicts_stored_child_rolls_back_child() {
        // Stored main-1..main-3 and main-5 (gap at 4). The chain has since
        // forked at 4, so backfilling fork-4 contradicts the parent pointer of
        // the stored main-5, which must be rolled back.
        let (db, handler) = setup("main", 1..=3, u32::MAX).await;
        let stale = chain("main", 1..=5, u32::MAX);
        let outcome = handler
            .ingest(&ledger("main", 5, u32::MAX), &stale)
            .await
            .unwrap();
        assert_eq!(outcome, IngestOutcome::Gap { from: 4, to: 4 });

        let canonical = chain("fork", 1..=5, 4);
        let outcome = handler
            .ingest(&ledger("fork", 4, 4), &canonical)
            .await
            .unwrap();
        let IngestOutcome::Reorg(report) = outcome else {
            panic!("expected reorg, got {outcome:?}");
        };
        assert_eq!(report.common_ancestor, Some(3));
        assert_eq!(
            stored_hashes(&db, 3..=5).await,
            vec![Some("main-3".into()), Some("fork-4".into()), None]
        );
    }

    #[tokio::test]
    async fn refuses_reorg_deeper_than_max_depth() {
        // Stored main-1..main-10; canonical diverges from ledger 2 (depth 9 > 5).
        let (db, handler) = setup("main", 1..=10, u32::MAX).await;
        let canonical = chain("fork", 1..=11, 2);

        let err = handler
            .ingest(&ledger("fork", 11, 2), &canonical)
            .await
            .unwrap_err();
        assert!(err.to_string().contains("deeper than 5"), "{err}");
        // Nothing was deleted.
        assert_eq!(db.get_ledger_tip().await.unwrap().unwrap().sequence, 10);
        assert!(db.get_event("evt-10").await.unwrap().is_some());
    }

    #[tokio::test]
    async fn errors_when_canonical_chain_is_missing_ledger() {
        let (db, handler) = setup("main", 1..=5, u32::MAX).await;
        let mut canonical = chain("fork", 1..=6, 4);
        canonical.0.remove(&3);

        let err = handler
            .ingest(&ledger("fork", 6, 4), &canonical)
            .await
            .unwrap_err();
        assert!(err.to_string().contains("no ledger 3"), "{err}");
        assert_eq!(db.get_ledger_tip().await.unwrap().unwrap().sequence, 5);
    }
}
