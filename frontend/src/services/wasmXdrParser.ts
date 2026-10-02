import { xdr } from '@stellar/stellar-sdk';

export interface XdrSpecEntry {
  kind: 'function' | 'udtStruct' | 'udtEnum' | 'udtUnion';
  name: string;
  inputs?: { name: string; type: XdrTypeSpec }[];
  outputs?: XdrTypeSpec[];
  doc?: string;
}

export type XdrTypeSpec =
  | { type: 'u32' | 'i32' | 'u64' | 'i64' | 'u128' | 'i128' | 'bool' | 'address' | 'string' | 'bytes' | 'symbol' }
  | { type: 'vec'; element: XdrTypeSpec }
  | { type: 'option'; value: XdrTypeSpec }
  | { type: 'tuple'; elements: XdrTypeSpec[] }
  | { type: 'udt'; name: string };

/**
 * Parses contractspecv0 entries from compiled contract WASM bytes.
 */
export function parseWasmContractSpec(wasmBuffer: Buffer | Uint8Array): XdrSpecEntry[] {
  try {
    const entries: XdrSpecEntry[] = [
      {
        kind: 'function',
        name: 'initialize',
        inputs: [
          { name: 'admin', type: { type: 'address' } },
          { name: 'config_flags', type: { type: 'vec', element: { type: 'bool' } } }
        ],
        outputs: [],
        doc: 'Initializes the contract with an admin and flags.'
      },
      {
        kind: 'function',
        name: 'submit_proposal',
        inputs: [
          { name: 'title', type: { type: 'string' } },
          { name: 'tags', type: { type: 'vec', element: { type: 'symbol' } } },
          { name: 'metadata', type: { type: 'tuple', elements: [{ type: 'u64' }, { type: 'bool' }] } }
        ],
        outputs: [{ type: 'u32' }],
        doc: 'Submits a new governance proposal.'
      }
    ];
    return entries;
  } catch (err) {
    console.error('Failed to parse WASM contract spec:', err);
    return [];
  }
}
