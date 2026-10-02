import { useCallback, useEffect, useRef, useState } from "react";
import {
  decideThreeWayMerge,
  loadEditorHistory,
  moveEditorHistoryHead,
  saveEditorSnapshot,
  type EditorConflict,
  type EditorSnapshot,
  type SaveSnapshotResult,
} from "@/utils/editorHistory";

export const EDITOR_WORKSPACE_ID = "playground:lib.rs";

export type EditorHistoryStatus =
  | "loading"
  | "saved"
  | "saving"
  | "conflict"
  | "unavailable";

export type ConflictResolution = "local" | "remote" | "manual";

export function useEditorHistory(
  code: string,
  restoreCode: (code: string) => void,
) {
  const initialCodeRef = useRef(code);
  const codeRef = useRef(code);
  const restoreCodeRef = useRef(restoreCode);
  const baseCodeRef = useRef(code);
  const headIdRef = useRef<string | null>(null);
  const conflictRef = useRef<EditorConflict | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const storageAvailableRef = useRef(true);
  const [snapshots, setSnapshots] = useState<EditorSnapshot[]>([]);
  const [headId, setHeadId] = useState<string | null>(null);
  const [conflict, setConflict] = useState<EditorConflict | null>(null);
  const [status, setStatus] = useState<EditorHistoryStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [saveAttempt, setSaveAttempt] = useState(0);

  const acceptSnapshot = useCallback(
    (snapshot: EditorSnapshot, restore = true) => {
      headIdRef.current = snapshot.id;
      baseCodeRef.current = snapshot.code;
      setHeadId(snapshot.id);
      setSnapshots((current) => upsertSnapshot(current, snapshot));
      if (restore) {
        codeRef.current = snapshot.code;
        restoreCodeRef.current(snapshot.code);
      }
      conflictRef.current = null;
      setConflict(null);
      setStatus("saved");
    },
    [],
  );

  const applySaveResult = useCallback(
    (result: SaveSnapshotResult, localCode: string) => {
      if (result.kind === "saved") {
        acceptSnapshot(result.snapshot, result.snapshot.code !== localCode);
        channelRef.current?.postMessage({ snapshot: result.snapshot });
        return true;
      }
      if (result.kind === "remote") {
        acceptSnapshot(result.snapshot);
        return true;
      }

      const nextConflict = { ...result.conflict, localCode };
      conflictRef.current = nextConflict;
      setConflict(nextConflict);
      setStatus("conflict");
      return false;
    },
    [acceptSnapshot],
  );

  useEffect(() => {
    codeRef.current = code;
    restoreCodeRef.current = restoreCode;
  }, [code, restoreCode]);

  useEffect(() => {
    let active = true;

    const initialize = async () => {
      try {
        let history = await loadEditorHistory(EDITOR_WORKSPACE_ID);
        let currentHead = history.snapshots.find(
          (snapshot) => snapshot.id === history.headId,
        );

        if (!currentHead) {
          await saveEditorSnapshot(
            EDITOR_WORKSPACE_ID,
            initialCodeRef.current,
            initialCodeRef.current,
          );
          history = await loadEditorHistory(EDITOR_WORKSPACE_ID);
          currentHead = history.snapshots.find(
            (snapshot) => snapshot.id === history.headId,
          );
        }

        if (!active) return;
        setSnapshots(history.snapshots);
        headIdRef.current = currentHead?.id ?? null;
        setHeadId(headIdRef.current);
        const editedBeforeHydration =
          codeRef.current !== initialCodeRef.current;
        baseCodeRef.current = editedBeforeHydration
          ? initialCodeRef.current
          : currentHead?.code ?? initialCodeRef.current;
        if (!editedBeforeHydration && currentHead) {
          codeRef.current = currentHead.code;
          restoreCodeRef.current(currentHead.code);
        }
        setStatus("saved");
        setIsReady(true);
        if (editedBeforeHydration) setSaveAttempt((attempt) => attempt + 1);
      } catch (cause) {
        if (!active) return;
        storageAvailableRef.current = false;
        setError(
          cause instanceof Error ? cause.message : "Editor history is unavailable",
        );
        setStatus("unavailable");
        setIsReady(true);
      }
    };

    void initialize();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!isReady || !storageAvailableRef.current) return;
    if (typeof BroadcastChannel === "undefined") return;

    const channel = new BroadcastChannel(
      `soroban-editor-history:${EDITOR_WORKSPACE_ID}`,
    );
    channelRef.current = channel;
    channel.onmessage = (event: MessageEvent<{ snapshot?: EditorSnapshot }>) => {
      const remoteSnapshot = event.data?.snapshot;
      if (
        !remoteSnapshot ||
        remoteSnapshot.workspaceId !== EDITOR_WORKSPACE_ID ||
        remoteSnapshot.id === headIdRef.current
      ) {
        return;
      }

      setSnapshots((current) => upsertSnapshot(current, remoteSnapshot));
      const localCode = codeRef.current;
      const baseCode = baseCodeRef.current;
      const decision = decideThreeWayMerge(
        baseCode,
        localCode,
        remoteSnapshot.code,
      );

      if (decision.kind === "conflict") {
        const nextConflict: EditorConflict = {
          baseCode,
          localCode,
          remoteSnapshot,
          detectedAt: Date.now(),
        };
        conflictRef.current = nextConflict;
        setConflict(nextConflict);
        setStatus("conflict");
      } else if (decision.kind === "remote" || decision.kind === "same") {
        acceptSnapshot(remoteSnapshot);
      } else {
        headIdRef.current = remoteSnapshot.id;
        setHeadId(remoteSnapshot.id);
        baseCodeRef.current = remoteSnapshot.code;
        if (decision.kind === "merged") {
          codeRef.current = decision.code;
          restoreCodeRef.current(decision.code);
        }
        conflictRef.current = null;
        setConflict(null);
        setStatus("saving");
        setSaveAttempt((attempt) => attempt + 1);
      }
    };

    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, [acceptSnapshot, isReady]);

  useEffect(() => {
    if (
      !isReady ||
      !storageAvailableRef.current ||
      conflict ||
      code === baseCodeRef.current
    ) {
      return;
    }

    const timeout = window.setTimeout(() => {
      const codeToSave = codeRef.current;
      const baseCode = baseCodeRef.current;
      if (codeToSave === baseCode) return;

      setStatus("saving");
      void saveEditorSnapshot(
        EDITOR_WORKSPACE_ID,
        baseCode,
        codeToSave,
      )
        .then((result) => {
          applySaveResult(result, codeRef.current);
        })
        .catch((cause: unknown) => {
          storageAvailableRef.current = false;
          setError(
            cause instanceof Error ? cause.message : "Unable to save editor history",
          );
          setStatus("unavailable");
        });
    }, 700);

    return () => window.clearTimeout(timeout);
  }, [applySaveResult, code, conflict, isReady, saveAttempt]);

  useEffect(() => {
    if (!conflict || conflict.localCode === code) return;
    const updatedConflict = { ...conflict, localCode: code };
    conflictRef.current = updatedConflict;
    setConflict(updatedConflict);
  }, [code, conflict]);

  const restoreSnapshot = async (snapshotId: string) => {
    const target = snapshots.find((snapshot) => snapshot.id === snapshotId);
    if (!target || !storageAvailableRef.current) return;

    try {
      if (codeRef.current !== baseCodeRef.current) {
        setStatus("saving");
        const result = await saveEditorSnapshot(
          EDITOR_WORKSPACE_ID,
          baseCodeRef.current,
          codeRef.current,
        );
        if (!applySaveResult(result, codeRef.current)) return;
      }

      await moveEditorHistoryHead(EDITOR_WORKSPACE_ID, target.id);
      acceptSnapshot(target, true);
      channelRef.current?.postMessage({ snapshot: target });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to restore this version",
      );
      setStatus("unavailable");
    }
  };

  const resolveConflict = async (
    resolution: ConflictResolution,
    manualCode?: string,
  ) => {
    const activeConflict = conflictRef.current;
    if (!activeConflict || !storageAvailableRef.current) return;

    const resolvedCode =
      resolution === "remote"
        ? activeConflict.remoteSnapshot.code
        : resolution === "manual"
          ? manualCode ?? codeRef.current
          : codeRef.current;
    setStatus("saving");

    try {
      const result = await saveEditorSnapshot(
        EDITOR_WORKSPACE_ID,
        activeConflict.remoteSnapshot.code,
        resolvedCode,
        resolution === "remote" ? "autosave" : "resolution",
      );
      if (!applySaveResult(result, resolvedCode)) return;
      if (result.kind === "saved" && resolution === "manual") {
        codeRef.current = resolvedCode;
        restoreCodeRef.current(resolvedCode);
      }
      conflictRef.current = null;
      setConflict(null);
      channelRef.current?.postMessage({
        snapshot: result.snapshot,
      });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to resolve this conflict",
      );
      setStatus("unavailable");
    }
  };

  return {
    snapshots,
    headId,
    conflict,
    status,
    error,
    restoreSnapshot,
    resolveConflict,
  };
}

function upsertSnapshot(
  snapshots: EditorSnapshot[],
  snapshot: EditorSnapshot,
) {
  return [...snapshots.filter((item) => item.id !== snapshot.id), snapshot].sort(
    (left, right) => left.createdAt - right.createdAt,
  );
}