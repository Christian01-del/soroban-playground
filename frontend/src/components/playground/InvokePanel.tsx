"use client";

import React, { useMemo } from "react";
import CallPanel from "@/components/CallPanel";
import {
  selectCode,
  selectContractAbiOverride,
  usePlaygroundStore,
} from "@/state/playgroundStore";
import { parseContractAbiFromSource } from "@/utils/contractAbi";

interface InvokePanelProps {
  onInvoke: React.ComponentProps<typeof CallPanel>["onInvoke"];
  isInvoking: boolean;
  contractId?: string;
}

function InvokePanel({ onInvoke, isInvoking, contractId }: InvokePanelProps) {
  const code = usePlaygroundStore(selectCode);
  const contractAbiOverride = usePlaygroundStore(selectContractAbiOverride);
  const parsedAbi = useMemo(() => parseContractAbiFromSource(code), [code]);
  const abi = contractAbiOverride ?? parsedAbi;

  return (
    <CallPanel
      onInvoke={onInvoke}
      isInvoking={isInvoking}
      contractId={contractId}
      abi={abi}
    />
  );
}

export default React.memo(InvokePanel);