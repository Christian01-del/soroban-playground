# Walkthrough - [FE-EPIC-20] State Diff Inspector with Time-Travel Ledger Rollback

## PR Title
`feat(frontend): state diff inspector with time-travel ledger rollback (#1511)`

---

## PR Description

### What
Implements the interactive State Diff Inspector with time-travel ledger rollback and state scrubber for Soroban contract invocations in Soroban Playground.

### Why
Closes #1511. Provides developers with interactive side-by-side and deep diff inspection of contract storage (instance, persistent, temporary) before and after invocations, with playback and frame scrubbing across historical simulation and transaction states.

### How
- **Pure Reducer Decoupling (`frontend/src/state/storageTimeline.ts`)**:
  - Decoupled `storageTimelineReducer` from the Zustand store instance, making it a pure function to eliminate circular dependencies.
  - Added `clear_snapshots` action and `clearSnapshots` store method for state reset.
  - Inverted delegation so `useStorageTimelineStore.reduce` delegates to the pure reducer.
- **Store-Connected Debugger (`frontend/src/components/StorageStateDiffDebugger.tsx`)**:
  - Wired `StorageStateDiffDebugger` directly to `useStorageTimelineStore` with seamless fallback to demo frames when no transactions are active.
  - Implemented play/pause automatic frame progression (`isPlaying`) with timer cleanup.
  - Wired category filters (`instance`, `persistent`, `temporary`) to snapshot source types.
  - Added snapshot clear button and synchronized timeline range slider with frame navigation.
- **Automated Regression Test Suites**:
  - `storageTimeline.test.ts`: Unit tests covering all reducer actions, boundaries, immutability, and store methods.
  - `StorageTimeline.test.tsx`: Tests for scrubber controls, frame counts, timestamp formatting, and disabled boundary states.
  - `StorageViewer.test.tsx`: Tests for deep diff calculation, added/removed/changed counters, empty states, and symbol sentinels.
  - `StorageStateDiffDebugger.test.tsx`: End-to-end component tests covering search filtering, playback timing, frame stepping, and live vs demo modes.

---

## Files Changed

| File | Changes |
| --- | --- |
| `frontend/src/state/storageTimeline.ts` | Decoupled reducer from Zustand, added `clear_snapshots` action & method |
| `frontend/src/components/StorageStateDiffDebugger.tsx` | Wired to live timeline store, added auto-play timer, clear action, category filtering |
| `frontend/src/__tests__/state/storageTimeline.test.ts` | Complete unit test coverage for pure reducer and Zustand store |
| `frontend/src/__tests__/components/StorageTimeline.test.tsx` | Unit test suite for timeline scrubber component |
| `frontend/src/__tests__/components/StorageViewer.test.tsx` | Unit test suite for storage viewer and deep diff engine |
| `frontend/src/__tests__/components/StorageStateDiffDebugger.test.tsx` | Integration test suite for debugger controls, auto-play, and filtering |

---

## CI Verification Results
- **Typecheck & Lint**: Clean syntax, strict adherence to existing TypeScript types and formatting.
- **Regressions**: Zero breaking changes or regressions introduced to existing workspace components.
