import { create } from "zustand";
import type { ContractAbiFunction } from "@/utils/contractAbi";

export const DEFAULT_CODE = `#![no_std]
use soroban_sdk::{contract, contractimpl, symbol_short, Env, Symbol};

#[contract]
pub struct HelloContract;

#[contractimpl]
impl HelloContract {
    pub fn hello(_env: Env, name: Symbol) -> Symbol {
        name
    }

    pub fn version(_env: Env) -> Symbol {
        symbol_short!("v1")
    }
}
`;

export const DEFAULT_API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ||
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  "https://soroban-playground.onrender.com";

export const INITIAL_LOGS = [
  "Soroban Playground ready.",
  `Frontend connected to ${DEFAULT_API_BASE_URL}`,
];

export interface PlaygroundState {
  code: string;
  logs: string[];
  contractAbiOverride: ContractAbiFunction[] | null;
  setCode: (code: string) => void;
  appendLog: (message: string) => void;
  resetContractAbi: () => void;
}

export const selectCode = (state: PlaygroundState) => state.code;
export const selectLogs = (state: PlaygroundState) => state.logs;
export const selectContractAbiOverride = (state: PlaygroundState) =>
  state.contractAbiOverride;
export const selectSetCode = (state: PlaygroundState) => state.setCode;
export const selectAppendLog = (state: PlaygroundState) => state.appendLog;

export const usePlaygroundStore = create<PlaygroundState>((set) => ({
  code: DEFAULT_CODE,
  logs: INITIAL_LOGS,
  contractAbiOverride: null,
  setCode: (code) => set({ code, contractAbiOverride: null }),
  appendLog: (message) =>
    set((state) => ({ logs: [...state.logs, message] })),
  resetContractAbi: () => set({ contractAbiOverride: [] }),
}));