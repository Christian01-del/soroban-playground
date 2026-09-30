import { jest } from '@jest/globals';
import { StrKey } from '@stellar/stellar-sdk';

jest.mock('../src/services/compileService.js', () => ({
  compileQueued: jest.fn(),
}));

function makeDb() {
  const rows = new Map();
  return {
    rows,
    async connect() {},
    async run(sql, params = []) {
      if (sql.includes('INSERT INTO contract_verification')) {
        rows.set(params[0], {
          id: params[0],
          contract_id: params[1],
          network: params[2],
          source_code: params[3],
          source_hash: params[4],
          dependencies: params[5],
          metadata: params[6],
          status: params[7],
          created_at: params[8],
          updated_at: params[9],
          wasm_hash: null,
          on_chain_wasm_hash: null,
          error_code: null,
          error_message: null,
          verified_at: null,
        });
      } else if (sql.includes('UPDATE contract_verification')) {
        const id = params[params.length - 1];
        const row = rows.get(id);
        if (sql.includes("status = 'pending'")) {
          Object.assign(row, {
            contract_id: params[0],
            network: params[1],
            source_code: params[2],
            source_hash: params[3],
            dependencies: params[4],
            metadata: params[5],
            status: 'pending',
            error_code: null,
            error_message: null,
            updated_at: params[6],
            verified_at: null,
          });
        } else {
          Object.assign(row, {
            wasm_hash: params[0],
            on_chain_wasm_hash: params[1],
            status: params[2],
            error_code: params[3],
            error_message: params[4],
            updated_at: params[5],
            verified_at: params[6],
          });
        }
      }
    },
    async get(sql, params = []) {
      if (sql.includes('SELECT * FROM contract_verification')) {
        return rows.get(params[0]) || null;
      }
      if (sql.includes('COUNT(*)')) return { total: rows.size };
      return null;
    },
    async all() {
      return [...rows.values()];
    },
  };
}

const {
  VerifyService,
  VerificationError,
  hashWasm,
  hashSource,
} = require('../src/services/verifyService.js');

const CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 1));
const SOURCE = '#![no_std]\npub fn contract() {}';
const WASM = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);

function createService(onChainWasm = WASM) {
  const db = makeDb();
  const service = new VerifyService({
    db,
    compile: jest.fn(),
    fetchOnChainWasm: jest.fn().mockResolvedValue(onChainWasm),
    now: jest.fn().mockReturnValue('2026-08-26T00:00:00.000Z'),
  });
  return { service, db };
}

describe('VerifyService', () => {
  it('hashes exact WASM bytes and reports a verified match', async () => {
    const { service } = createService();
    const result = await service.verifyContract({
      id: 'verification-1',
      contractId: CONTRACT_ID,
      sourceCode: SOURCE,
      wasmBase64: WASM.toString('base64'),
    });

    expect(result.status).toBe('verified');
    expect(result.verified).toBe(true);
    expect(result.wasmHash).toBe(hashWasm(WASM));
    expect(result.onChainWasmHash).toBe(hashWasm(WASM));
    expect(result.sourceHash).toBe(hashSource(SOURCE));
  });

  it('records a mismatch when compiled bytes differ from on-chain bytes', async () => {
    const { service } = createService(Buffer.concat([WASM, Buffer.from([1])]));
    const result = await service.verifyContract({
      contractId: CONTRACT_ID,
      sourceCode: SOURCE,
      wasmBase64: WASM.toString('base64'),
    });

    expect(result.status).toBe('mismatch');
    expect(result.verified).toBe(false);
    expect(result.wasmHash).not.toBe(result.onChainWasmHash);
  });

  it('compiles source when no WASM artifact is supplied', async () => {
    const { service } = createService();
    service.compile.mockResolvedValue({
      success: true,
      logs: ['compiled'],
      artifact: { path: '/tmp/contract.wasm' },
    });
    service.readFile = jest.fn().mockResolvedValue(WASM);

    const result = await service.verifyContract({
      contractId: CONTRACT_ID,
      sourceCode: SOURCE,
      dependencies: { 'serde-json': '^1.0' },
    });

    expect(service.compile).toHaveBeenCalledWith(
      expect.objectContaining({
        code: SOURCE,
        dependencies: { 'serde-json': '^1.0' },
      })
    );
    expect(result.status).toBe('verified');
  });

  it('rejects dependency input that is not safe for Cargo generation', async () => {
    const { service } = createService();

    await expect(
      service.verifyContract({
        contractId: CONTRACT_ID,
        sourceCode: SOURCE,
        dependencies: { 'bad-name': '1.0\nmalicious = true' },
      })
    ).rejects.toMatchObject({
      code: 'INVALID_DEPENDENCIES',
      statusCode: 400,
    });
  });

  it('persists a failed status when source compilation fails', async () => {
    const { service, db } = createService();
    service.compile.mockRejectedValue(new Error('cargo: syntax error'));

    await expect(
      service.verifyContract({
        id: 'failed-1',
        contractId: CONTRACT_ID,
        sourceCode: SOURCE,
      })
    ).rejects.toMatchObject({
      code: 'COMPILATION_FAILED',
      statusCode: 422,
    });

    expect(db.rows.get('failed-1')).toMatchObject({
      status: 'failed',
      error_code: 'COMPILATION_FAILED',
    });
  });

  it('rejects malformed contract IDs, source, and oversized input', async () => {
    const { service } = createService();

    await expect(
      service.verifyContract({
        contractId: 'not-a-contract',
        sourceCode: SOURCE,
      })
    ).rejects.toMatchObject({ code: 'INVALID_CONTRACT_ID', statusCode: 400 });

    await expect(
      service.verifyContract({ contractId: CONTRACT_ID, sourceCode: ' ' })
    ).rejects.toMatchObject({ code: 'INVALID_SOURCE', statusCode: 400 });

    const smallService = new VerifyService({
      db: makeDb(),
      maxSourceBytes: 3,
      compile: jest.fn(),
    });
    await expect(
      smallService.verifyContract({
        contractId: CONTRACT_ID,
        sourceCode: 'abcd',
      })
    ).rejects.toMatchObject({ code: 'SOURCE_TOO_LARGE', statusCode: 413 });
  });

  it('does not expose source code in status records or search results', async () => {
    const { service } = createService();
    const result = await service.verifyContract({
      id: 'privacy-1',
      contractId: CONTRACT_ID,
      sourceCode: SOURCE,
      wasmBase64: WASM.toString('base64'),
    });
    const status = await service.getVerification(result.id);
    const search = await service.searchVerifications();

    expect(status).not.toHaveProperty('sourceCode');
    expect(search.records[0]).not.toHaveProperty('sourceCode');
    await expect(service.getSource(result.id)).resolves.toMatchObject({
      sourceCode: SOURCE,
    });
  });

  it('does not expose source for a mismatched verification', async () => {
    const { service } = createService(Buffer.concat([WASM, Buffer.from([1])]));
    const result = await service.verifyContract({
      contractId: CONTRACT_ID,
      sourceCode: SOURCE,
      wasmBase64: WASM.toString('base64'),
    });

    await expect(service.getSource(result.id)).rejects.toMatchObject({
      code: 'SOURCE_NOT_VERIFIED',
      statusCode: 409,
    });
  });

  it('does not allow a submission to overwrite an existing record id', async () => {
    const { service, db } = createService();
    const first = await service.verifyContract({
      id: 'owned-id',
      contractId: CONTRACT_ID,
      sourceCode: SOURCE,
      wasmBase64: WASM.toString('base64'),
    });
    const second = await service.submitVerification({
      id: first.id,
      contractId: CONTRACT_ID,
      sourceCode: `${SOURCE}\n// changed`,
      wasmBase64: WASM.toString('base64'),
    });

    expect(second.id).not.toBe(first.id);
    expect(db.rows.has(second.id)).toBe(true);
  });

  it('uses the SDK-compatible RPC client when no custom fetcher is supplied', async () => {
    const db = makeDb();
    const getContractWasmByContractId = jest.fn().mockResolvedValue(WASM);
    const rpcClientFactory = jest.fn().mockResolvedValue({
      getContractWasmByContractId,
    });
    const service = new VerifyService({
      db,
      rpcClientFactory,
      compile: jest.fn().mockResolvedValue({
        success: true,
        artifact: { path: '/tmp/contract.wasm' },
      }),
      readFile: jest.fn().mockResolvedValue(WASM),
    });

    await service.verifyContract({
      contractId: CONTRACT_ID,
      sourceCode: SOURCE,
    });

    expect(rpcClientFactory).toHaveBeenCalledWith('testnet');
    expect(getContractWasmByContractId).toHaveBeenCalledWith(CONTRACT_ID);
  });
});

describe('hash helpers', () => {
  it('rejects non-binary WASM values', () => {
    expect(() => hashWasm('wasm')).toThrow(VerificationError);
  });
});
