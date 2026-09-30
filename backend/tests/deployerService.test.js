// Test suite for the Deployer Service input-handling layer.
//
// Covers the pure, side-effect-free parts of the deploy pipeline:
// normalization, batch validation, and dependency ordering. These run before
// any child process is spawned, so they need no fs/spawn mocking.

const {
  normalizeBatchContract,
  validateBatchContractsInput,
  topoSortContracts,
} = require('../src/services/deployUtils.js');

function contract(overrides = {}) {
  return {
    contractName: 'token',
    wasmPath: '/tmp/token.wasm',
    ...overrides,
  };
}

describe('normalizeBatchContract', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('fills in a default id derived from the contract name and position', () => {
    const result = normalizeBatchContract(contract(), 0);
    expect(result.id).toBe('token-1');
  });

  it('preserves an explicit id', () => {
    const result = normalizeBatchContract(contract({ id: 'custom' }), 3);
    expect(result.id).toBe('custom');
  });

  it('accepts `name` as an alias for `contractName`', () => {
    const result = normalizeBatchContract(
      { name: 'vault', wasmPath: '/tmp/vault.wasm' },
      0
    );
    expect(result.contractName).toBe('vault');
  });

  it('throws when wasmPath is missing or not a string', () => {
    expect(() => normalizeBatchContract({ contractName: 'token' }, 0)).toThrow(
      'contracts[0].wasmPath is required'
    );
    expect(() =>
      normalizeBatchContract({ contractName: 'token', wasmPath: 42 }, 1)
    ).toThrow('contracts[1].wasmPath is required');
  });

  it('throws when the contract name is missing', () => {
    expect(() =>
      normalizeBatchContract({ wasmPath: '/tmp/a.wasm' }, 2)
    ).toThrow('contracts[2].contractName is required');
  });

  it('throws on a null contract rather than dereferencing it', () => {
    expect(() => normalizeBatchContract(null, 0)).toThrow(
      'contracts[0].wasmPath is required'
    );
  });

  it('drops non-string entries from the dependency list', () => {
    const result = normalizeBatchContract(
      contract({ dependencies: ['a', 7, null, 'b'] }),
      0
    );
    expect(result.dependencies).toEqual(['a', 'b']);
  });

  it('defaults dependencies to an empty array when absent or malformed', () => {
    expect(normalizeBatchContract(contract(), 0).dependencies).toEqual([]);
    expect(
      normalizeBatchContract(contract({ dependencies: 'nope' }), 0).dependencies
    ).toEqual([]);
  });

  it('falls back to the explicit default network, then the env default', () => {
    process.env.DEFAULT_NETWORK = 'futurenet';
    expect(normalizeBatchContract(contract(), 0).network).toBe('futurenet');
    expect(normalizeBatchContract(contract(), 0, 'mainnet').network).toBe(
      'mainnet'
    );
    expect(
      normalizeBatchContract(contract({ network: 'testnet' }), 0, 'mainnet')
        .network
    ).toBe('testnet');
  });

  it('inherits the source account from the environment when not provided', () => {
    process.env.SOROBAN_SOURCE_ACCOUNT = 'GENV';
    expect(normalizeBatchContract(contract(), 0).sourceAccount).toBe('GENV');
    expect(
      normalizeBatchContract(contract({ sourceAccount: 'GEXPLICIT' }), 0)
        .sourceAccount
    ).toBe('GEXPLICIT');
  });
});

describe('validateBatchContractsInput', () => {
  it('rejects non-arrays', () => {
    expect(() => validateBatchContractsInput(undefined)).toThrow(
      'contracts must be a non-empty array'
    );
    expect(() => validateBatchContractsInput({})).toThrow(
      'contracts must be a non-empty array'
    );
  });

  it('rejects an empty array', () => {
    expect(() => validateBatchContractsInput([])).toThrow(
      'contracts must be a non-empty array'
    );
  });

  it('returns the input unchanged when valid', () => {
    const input = [contract()];
    expect(validateBatchContractsInput(input)).toBe(input);
  });
});

describe('topoSortContracts', () => {
  const node = (id, dependencies = []) => ({ id, dependencies });

  it('returns contracts in dependency order', () => {
    const ordered = topoSortContracts([
      node('app', ['token']),
      node('token'),
      node('vault', ['app']),
    ]);
    expect(ordered.map((c) => c.id)).toEqual(['token', 'app', 'vault']);
  });

  it('keeps independent contracts in their original order', () => {
    const ordered = topoSortContracts([node('a'), node('b'), node('c')]);
    expect(ordered.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('throws when a dependency is not part of the batch', () => {
    expect(() => topoSortContracts([node('app', ['ghost'])])).toThrow(
      'Missing dependency "ghost" for app'
    );
  });

  it('detects circular dependencies', () => {
    expect(() =>
      topoSortContracts([node('a', ['b']), node('b', ['a'])])
    ).toThrow('Circular dependency detected in batch deployment');
  });

  it('handles an empty batch', () => {
    expect(topoSortContracts([])).toEqual([]);
  });
});
