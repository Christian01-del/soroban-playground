"use client";

import { useCallback, useReducer } from "react";

export type TxStatus = "pending" | "success" | "error";

export interface Transaction {
  id: string;
  label: string;
  status: TxStatus;
  hash?: string;
  error?: string;
  timestamp: number;
}

type State = {
  transactions: Transaction[];
};

type SetTransactionsAction = {
  type: "set";
  transactions: Transaction[];
};

type AddTransactionAction = {
  type: "add";
  transaction: Transaction;
};

type UpdateTransactionAction = {
  type: "update";
  id: string;
  update: Partial<Pick<Transaction, "status" | "hash" | "error">>;
};

type ClearTransactionsAction = {
  type: "clear";
};

type Action =
  | SetTransactionsAction
  | AddTransactionAction
  | UpdateTransactionAction
  | ClearTransactionsAction;

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "set":
      return { transactions: action.transactions };
    case "add":
      return { transactions: [action.transaction, ...state.transactions] };
    case "update":
      return {
        transactions: state.transactions.map((tx) =>
          tx.id === action.id ? { ...tx, ...action.update } : tx,
        ),
      };
    case "clear":
      return { transactions: [] };
    default:
      return state;
  }
}

export function useTransactionTracker() {
  const [state, dispatch] = useReducer(reducer, { transactions: [] });

  const addTx = useCallback((label: string): string => {
    const id = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    dispatch({
      type: "add",
      transaction: { id, label, status: "pending", timestamp: Date.now() },
    });
    return id;
  }, []);

  const updateTx = useCallback(
    (
      id: string,
      update: Partial<Pick<Transaction, "status" | "hash" | "error">>,
    ) => {
      dispatch({ type: "update", id, update });
    },
    [],
  );

  const clearTx = useCallback(() => dispatch({ type: "clear" }), []);

  return { transactions: state.transactions, addTx, updateTx, clearTx };
}
