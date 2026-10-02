export function normalizeBatchContract(contract, index, defaultNetwork) {
  const wasmPath = contract?.wasmPath;
  const contractName = contract?.contractName || contract?.name;

  if (!wasmPath || typeof wasmPath !== 'string') {
    throw new Error(`contracts[${index}].wasmPath is required`);
  }
  if (!contractName || typeof contractName !== 'string') {
    throw new Error(`contracts[${index}].contractName is required`);
  }

  return {
    id: contract.id || `${contractName}-${index + 1}`,
    contractName,
    wasmPath,
    dependencies: Array.isArray(contract.dependencies)
      ? contract.dependencies.filter((dep) => typeof dep === 'string')
      : [],
    sourceAccount:
      typeof contract.sourceAccount === 'string'
        ? contract.sourceAccount
        : process.env.SOROBAN_SOURCE_ACCOUNT,
    network:
      contract.network ||
      defaultNetwork ||
      process.env.DEFAULT_NETWORK ||
      'testnet',
  };
}

export function validateBatchContractsInput(contracts) {
  if (!Array.isArray(contracts) || contracts.length === 0) {
    throw new Error('contracts must be a non-empty array');
  }
  return contracts;
}

export function topoSortContracts(contracts) {
  const graph = new Map(contracts.map((contract) => [contract.id, contract]));
  const inDegree = new Map(contracts.map((contract) => [contract.id, 0]));
  const edges = new Map(contracts.map((contract) => [contract.id, []]));

  for (const contract of contracts) {
    for (const dep of contract.dependencies) {
      if (!graph.has(dep)) {
        throw new Error(`Missing dependency "${dep}" for ${contract.id}`);
      }
      edges.get(dep).push(contract.id);
      inDegree.set(contract.id, inDegree.get(contract.id) + 1);
    }
  }

  const queue = contracts
    .filter((contract) => inDegree.get(contract.id) === 0)
    .map((contract) => contract.id);
  const ordered = [];

  while (queue.length > 0) {
    const id = queue.shift();
    ordered.push(graph.get(id));
    for (const nextId of edges.get(id)) {
      inDegree.set(nextId, inDegree.get(nextId) - 1);
      if (inDegree.get(nextId) === 0) {
        queue.push(nextId);
      }
    }
  }

  if (ordered.length !== contracts.length) {
    throw new Error('Circular dependency detected in batch deployment');
  }

  return ordered;
}

/**
 * Deploy pipeline step definitions for the 4-step wizard:
 *   1. Compile  -> 2. Upload WASM -> 3. Create Contract -> 4. Initialize
 */
export const DEPLOY_STEPS = Object.freeze([
  { id: 'compile', label: 'Compile' },
  { id: 'upload', label: 'Upload WASM' },
  { id: 'create', label: 'Create Contract' },
  { id: 'initialize', label: 'Initialize' },
]);

/**
 * Validate and normalize the input for a deploy pipeline request.
 * Returns a normalized descriptor with the ordered contracts and the step list.
 */
export function buildDeployPlanPayload(contracts, defaultNetwork) {
  validateBatchContractsInput(contracts);
  const normalized = contracts.map((contract, index) =>
    normalizeBatchContract(contract, index, defaultNetwork),
  );
  const ordered = topoSortContracts(normalized);
  return {
    steps: DEPLOY_STEPS.map((step) => step.id),
    contracts: ordered,
  };
}

/**
 * Build the payload submitted to Stellar Expert for verification after a
 * successful deploy. The payload is deterministic and includes the contract
 * address, the WASM hash, and the network so the verification service can
 * resolve the deployed artifact.
 */
export function buildStellarExpertVerificationPayload({
  contractId,
  wasmHash,
  network,
  contractName,
}) {
  if (!contractId || typeof contractId !== 'string') {
    throw new Error('contractId is required for Stellar Expert verification');
  }
  if (!wasmHash || typeof wasmHash !== 'string') {
    throw new Error('wasmHash is required for Stellar Expert verification');
  }
  const resolvedNetwork = network || process.env.DEFAULT_NETWORK || 'testnet';
  return {
    contractId,
    wasmHash,
    network: resolvedNetwork,
    contractName: contractName || null,
    source: 'soroban-playground',
  submittedAt: new Date().toISOString(),
  };
}

/**
 * Resolve the public Stellar Expert URL for a given contract address.
 */
export function getStellarExpertContractUrl(contractId, network) {
  if (!contractId || typeof contractId !== 'string') {
    throw new Error('contractId is required to build a Stellar Expert URL');
  }
  const resolvedNetwork = network || process.env.DEFAULT_NETWORK || 'testnet';
  const networkSegment = resolvedNetwork === 'mainnet' ? 'public' : 'testnet';
  return `https://stellar.expert/contract/${networkSegment}/${encodeURIComponent(contractId)}`;
}
