import type { LedgerState } from "@/utils/transactionGraph";

export function cloneValue<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => cloneValue(entry)) as T;
  }

  const clone: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(
    value as Record<string, unknown>,
  )) {
    clone[key] = cloneValue(nested);
  }
  return clone as T;
}

export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      deepFreeze(entry);
    }
  } else {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested);
    }
  }

  return Object.freeze(value);
}

export function immutableLedgerState(state: LedgerState): LedgerState {
  return deepFreeze(cloneValue(state));
}
