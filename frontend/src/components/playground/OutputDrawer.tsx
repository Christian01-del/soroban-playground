"use client";

import React from "react";
import { ConsoleAndEventsDrawer } from "@/components/ConsoleAndEventsDrawer";
import {
  selectLogs,
  usePlaygroundStore,
} from "@/state/playgroundStore";

interface OutputDrawerProps {
  droppedMessages: number;
  isIngestionPaused: boolean;
  onIngestionPauseChange: (paused: boolean) => void;
  contractId?: string;
}

function OutputDrawer({
  droppedMessages,
  isIngestionPaused,
  onIngestionPauseChange,
  contractId,
}: OutputDrawerProps) {
  const logs = usePlaygroundStore(selectLogs);

  return (
    <ConsoleAndEventsDrawer
      logs={logs}
      baseLineNumber={0}
      droppedMessages={droppedMessages}
      isIngestionPaused={isIngestionPaused}
      onIngestionPauseChange={onIngestionPauseChange}
      contractId={contractId}
    />
  );
}

export default React.memo(OutputDrawer);