import { useQuery, useQueryClient, useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { Contract, xdr', Native } from '@stellar/stellar-sdk';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface ContractDataKey[name extends string = string] {
  readonly _tag: 'contract-data';
  readonly contractId: string;
  readonly networkPassphrase: string;
  readonly method: name;
  readonly args: readonly unknown[];
}

export interface ContractDataResult<T> {
  readonly data: T;
  readonly lastLedger: number;
}

export interface UseContractDataOptions<T> {
  readonly contractId: string;
  readonly networkPassphrase: string;
  readonly method: string;
  readonly args?: readonly unknown[];
  readonly enabled?: boolean;
  readonly staleTime?: number;
  readonly refetchInterval?: number;
  readonly select?: (data: ContractDataResult<T>) => T;
}

export interface OptimisticUpdateContext<T> {
  readonly previous: ContractDataResult<T> | undefined;
  readonly key: ContractDataKey;
}

// -----------------------------------------------------------------------------
// Query key factory: deterministic, serializable, and namespaced.
// -----------------------------------------------------------------------------

function normalizeArg<T>(arg: T): unknown {
  if (arg === null || arg === undefined) {
    return null;
  }
  if (typeof arg === 'bigint') {
    return arg.toString();
  }
  if (arg instanceof Native) {
    return arg.toString();
  }
  if (Array.isArray(arg)) {
    return (arg as unknown[]).map(normalizeArg);
  }
  if (typeof arg === 'object') {
    const obj = arg as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      out[key] = normalizeArg(obj[key]);
    }
    return out;
  }
  return arg;
}

export function contractDataKey<name extends string>(
  contractId: string,
  networkPassphrase: string,
  method: name,
  args: readonly unknown[] = [],
): ContractDataKey<name> {
  if (!contractId) {
    throw new Error('contractDataKey: contractId is required');
  }
  if (!networkPassphrase) {
    throw new Error('contractDataKey: networkPassphrase is required');
  }
  if (!method) {
    throw new Error('contractDataKey: method is required');
  }
  return {
    _tag: 'contract-data',
    contractId,
    networkPassphrase,
    method,
    args: args.map(normalizeArg).sort((a, b) => {
      const sa = JSON.stringify(a);
      const sb = JSON.stringify(b);
      return sa < sb ? -1 : sa > sb ? 1 : 0;
    }),
  };
}

export function contractDataKeyPrefix(
  contractId?: string,
  networkPassphrase?: string,
): readonly unknown[] {
  const prefix: unknown[] = [{ _tag: 'contract-data' }];
  if (contractId !== undefined) prefix.push(contractId);
  if (networkPassphrase !== undefined) prefix.push(networkPassphrase);
  return prefix;
}

// -----------------------------------------------------------------------------
// Contract client factory (injectable for testing)
// -----------------------------------------------------------------------------

export interface ContractClient {
  readMethod<T>(method: string, args: readonly unknown[]): Promise<ContractDataResult<T>>;
  simulateTransaction<T>(
    method: string,
    args: readonly unknown[],
  ): Promise<ContractDataResult<T>>;
}

export type ContractClientFactory = (contractId: string, networkPassphrase: string) => ContractClient;

let clientFactory: ContractClientFactory | undefined;

export function setContractClientFactory(factory: ContractClientFactory | undefined): void {
  clientFactory = factory;
}

function getClient(contractId: string, networkPassphrase: string): ContractClient {
  if (!clientFactory) {
    throw new Error(
      'useContractData: no contract client factory configured. Call setContractClientFactory() during app bootstrap.',
    );
  }
  return clientFactory(contractId, networkPassphrase);
}

// -----------------------------------------------------------------------------
// Read hook
// -----------------------------------------------------------------------------

export function useContractData<T>(
  options: UseContractDataOptions<T>,
)) {
  const {
    contractId,
    networkPassphrase,
    method,
    args = [],
    enabled = true,
    staleTime,
    refetchInterval,
    select,
  } = options;

  const key = contractDataKey(contractId, networkPassphrase, method, args);

  return useQuery<ContractDataResult<T>, Error, T>( {
    queryKey: key,
    enabled,
    staleTime,
    refetchInterval,
    queryFn: async () => {
      const client = getClient(contractId, networkPassphrase);
      return client.readMethod<T>(method, args);
    },
    select,
  });
}

// -----------------------------------------------------------------------------
// Optimistic update hook with rollback
// -----------------------------------------------------------------------------

export interface UseOptimisticContractMutationOptions<T> {
  readonly contractId: string;
  readonly networkPassphrase: string;
  readonly method: string;
  readonly args?: readonly unknown[];
  readonly optimisticUpdate?: (current: ContractDataResult<T> | undefined) => ContractDataResult<T>;
  readonly mutationFn: (args: readonly unknown[]) => Promise<ContractDataResult<T>>;
}

export function useOptimisticContractMutation<T>(
  options: UseOptimisticContractMutationOptions<T>,
)) {
  const { contractId, networkPassphrase, method, args = [], optimisticUpdate, mutationFn } = options;
  const queryClient = useQueryClient();
  const key = contractDataKey(contractId, networkPassphrase, method, args);

  return useMutation<ContractDataResult<T>, Error, readonly unknown[], OptimisticUpdateContext<T>>(
    {
      mutationFn: async (mutationArgs) => mutationFn(args.length ? args : mutationArgs),
      onMutate: async (_newData, _variables, context) => {
        if (!context) return;
        await queryClient.cancelQueries({ queryKey: contractDataKeyPrefix(contractId, networkPassphrase) });
        const previous = queryClient.getQueryData<ContractDataResult<T>>(key);
        context.previous = previous;
        if (optimisticUpdate) {
          queryClient.setQueryData(key, optimisticUpdate(previous));
        }
      },
      onError: (_err, _variables, context) => {
        if (context?.previous !== undefined) {
          queryClient.setQueryData(key, context.previous);
        } else {
          queryClient.removeQueries({ queryKey: key });
        }
      },
      onSettled: () => {
        void queryClient.invalidateQueries({
          queryKey: contractDataKeyPrefix(contractId, networkPassphrase),
        });
      },
    },
  );
}

// -----------------------------------------------------------------------------
// Invalidation helpers
// -----------------------------------------------------------------------------

export function useInvalidateContractData() {
  const queryClient = useQueryClient();
  return useCallback(
    (contractId?: string, networkPassphrase?: string) => {
      return queryClient.invalidateQueries({
        queryKey: contractDataKeyPrefix(contractId, networkPassphrase),
      });
    },
    [queryClient],
  );
}
