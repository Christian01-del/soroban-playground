import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import {
  createSpan,
  setSpanAttributes,
  addSpanEvent,
  injectTraceContext,
} from '../utils/tracing.js';
const { createHash } = await import('crypto');
import { recordTamperEvidentAuditLog } from './tamperEvidentAuditLogger.js';
import { spawnTracked, terminateChildProcess } from './childProcessManager.js';

const MAX_CONCURRENT = Number.parseInt(process.env.INVOKE_POOL_SIZE || '3', 10);
const INVOKE_TIMEOUT_MS = Number.parseInt(
	process.env.INVOKE_TIMEOUT_MS || '30000',
	10
);
const INVOKE_LOG_FILE =
	process.env.INVOKE_LOG_FILE || path.join(process.cwd(), 'logs', 'invoke.log');
const CONTRACT_ID_RE = /^C[A-Z0-9]{55}$/;
const FUNCTION_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SOURCE_ACCOUNT_RE = /^G[A-Z0-9]{56}$/;
const SIGNATURE_RE = /^[A-Za-z0-9]+$/;
const SENSITIVE_ARG_KEYS = new Set([
	'secret',
	'password',
	'token',
	'privateKey',
	'private_key',
]);

const queue = [];
let activeCount = 0;

function ensureLogFile() {
	fs.mkdirSync(path.dirname(INVOKE_LOG_FILE), { recursive: true });
}

function logInvocation(entry) {
	ensureLogFile();
	fs.appendFileSync(INVOKE_LOG_FILE, `${JSON.stringify(entry)}\n`, 'utf8');
}

function sanitizeArgs(args = {}) {
	return Object.fromEntries(
		Object.entries(args).map(([key, value]) => [
			key,
			SENSITIVE_ARG_KEYS.has(key) ? '[REDACTED]' : value,
		])
	);
}

function sanitizeLogRequest(request) {
	return {
		...request,
		sourceAccount: request.sourceAccount ? '[REDACTED]' : undefined,
		args: sanitizeArgs(request.args),
	};
}

function normalizeAuthTree(authTree) {
	if (authTree === undefined || authTree === null) return null;
	if (typeof authTree !== 'object' || Array.isArray(authTree)) {
		throw new Error('authTree must be an object');
	}
	const nodes = Array.isArray(authTree.nodes) ? authTree.nodes : [];
	return {
		root: authTree.root ?? null,
		nodes: nodes.map((node, index) => {
			if (!node || typeof node !== 'object') {
				throw new Error(`authTree.nodes[${index}] must be an object`);
			}
			const id = node.id ?? `node-${index}`;
			const type = node.type ?? (index === 0 ? 'root' : 'leaf');
			return {
				id,
				type,
				publicKey: node.publicKey ?? node.public_key ?? null,
				weight: Number.isFinite(node.weight) ? node.weight : 1,
				threshold: Number.isFinite(node.threshold) ? node.threshold : 1,
				children: Array.isArray(node.children) ? node.children : [],
				metadata: node.metadata ?? null,
			};
		}),
	};
}

function normalizeInvokers(invokers) {
	if (invokers === undefined || invokers === null) return [];
	if (!Array.isArray(invokers)) {
		throw new Error('invokers must be an array');
	}
	return invokers.map((invoker, index) => {
		if (typeof invoker === 'string') {
			return { address: invoker, signature: null, weight: 1 };
		}
		if (!invoker || typeof invoker !== 'object') {
			throw new Error(`invokers[${index}] must be a string or object`);
		}
		const address = invoker.address ?? invoker.publicKey ?? invoker.public_key;
		if (!address || typeof address !== 'string') {
			throw new Error(`invokers[${index}].address is required`);
		}
		return {
			address,
			signature: invoker.signature ?? invoker.sig ?? null,
			weight: Number.isFinite(invoker.weight) ? invoker.weight : 1,
		};
	});
}

export function validateInvocationRequest(request = {}) {
	const errors = [];
	if (!CONTRACT_ID_RE.test(request.contractId || '')) {
		errors.push('contractId must be a valid Stellar contract ID');
	}
	if (!FUNCTION_NAME_RE.test(request.functionName || '')) {
		errors.push('functionName must be a valid contract function identifier');
	}
	if (
		request.args !== undefined &&
		(request.args === null ||
			typeof request.args !== 'object' ||
			Array.isArray(request.args))
	) {
		errors.push('args must be an object');
	}
	if (request.sourceAccount !== undefined && request.sourceAccount !== null) {
		if ( typeof request.sourceAccount !== 'string' || !SOURCE_ACCOUNT_RE.test(request.sourceAccount)) {
			errors.push('sourceAccount must be a valid Stellar account address');
		}
	}
	if (request.require_auth !== undefined && typeof request.require_auth !== 'boolean') {
		errors.push('require_auth must be a boolean');
	}
	if (request.invokers !== undefined) {
		try {
			const invokers = normalizeInvokers(request.invokers);
			for (const invoker of invokers) {
				if (!SOURCE_ACCOUNT_RE.test(invoker.address)) {
					errors.push(`invoker address "${invoker.address}" is not a valid Stellar address`);
				}
				if (invoker.signature !== null && (typeof invoker.signature !== 'string' || !SIGNATURE_RE.test(invoker.signature))) {
					errors.push(`invoker signature for "${invoker.address}" is invalid`);
				}
			}
		} catch (error) {
			errors.push(error.message);
		}
	}
	if (request.authTree !== undefined) {
		try {
			normalizeAuthTree(request.authTree);
		} catch (error) {
			errors.push(error.message);
		}
	}
	return errors;
}

function appendCliArg(cliArgs, key, value) {
	if (!FUNCTION_NAME_RE.test(key)) {
		throw new Error(`Invalid invocation argument name "${key}"`);
	}
	if (Array.isArray(value)) {
		for (const item of value) appendCliArg(cliArgs, key, item);
		return;
	}
	if (value === undefined || value === null) return;

	cliArgs.push(`--${key}`);
	cliArgs.push(
		typeof value === 'object' ? JSON.stringify(value) : String(value)
	);
}

export function createCliArgs(request) {
	const validationErrors = validateInvocationRequest(request);
	if (validationErrors.length > 0) {
		throw new Error(validationErrors.join('; '));
	}

	const sourceAccount =
		request.sourceAccount || process.env.SOROBAN_SOURCE_ACCOUNT;
	if (!sourceAccount) {
		throw new Error(
			'SOROBAN_SOURCE_ACCOUNT is required to invoke a contract on testnet.'
		);
	}

	const cliArgs = [
		'contract',
		'invoke',
		'--id',
		request.contractId,
		'--source-account',
		sourceAccount,
		'--network',
		request.network || process.env.DEFAULT_NETWORK || 'testnet',
	];

	if (request.require_auth === true) {
		cliArgs.push('--require-auth');
	}

	const invokers = normalizeInvokers(request.invokers);
	for (const invoker of invokers) {
		cliArgs.push('--invoker');
		cliArgs.push(invoker.address);
		if (invoker.signature) {
			cliArgs.push('--invoker-signature');
			cliArgs.push(invoker.signature);
		}
	}

	if (request.authTree !== undefined && request.authTree !== null) {
		cliArgs.push('--auth-tree');
		cliArgs.push(JSON.stringify(normalizeAuthTree(request.authTree)));
	}

	cliArgs.push('--');
	cliArgs.push(request.functionName);

	for (const [key, value] of Object.entries(request.args || {})) {
		appendCliArg(cliArgs, key, value);
	}

	return cliArgs;
}

export function parseCliOutput(stdout = '') {
	const trimmed = stdout.trim();
	if (!trimmed) {
		return { raw: '', parsed: null };
	}

	try {
		return { raw: trimmed, parsed: JSON.parse(trimmed) };
	} catch {
		return { raw: trimmed, parsed: trimmed };
	}
}

export function getInvocationQueueStats() {
	return {
		activeCount,
		queuedCount: queue.length,
		maxConcurrent: MAX_CONCURRENT,
	};
}

function runQueued(task) {
	return new Promise((resolve, reject) => {
		queue.push({ task, resolve, reject });
		pumpQueue();
	});
}

function pumpQueue() {
	while (activeCount < MAX_CONCURRENT && queue.length > 0) {
		const item = queue.shift();
		activeCount += 1;
		item
			.task()
			.then(item.resolve)
			.catch(item.reject)
			.finally(() => {
				activeCount -= 1;
				pumpQueue();
			});
	}
}

export class InvokeProgressBus extends EventEmitter {}

export const invokeProgressBus = new InvokeProgressBus();

function buildAuthorizationMatrix(request) {
	const invokers = normalizeInvokers(request.invokers);
	const authTree = normalizeAuthTree(request.authTree);
	const matrix = {
		require_auth: request.require_auth === true,
		invokers: invokers,
		authTree,
		generatedAt: new Date().toISOString(),
	};
	const digest = createHash('sha256');
	digest.update(JSON.stringify({
		require_auth: matrix.require_auth,
		invokers: matrix.invokers,
		authTree: matrix.authTree,
	}));
	matrix.digest = digest.digest('hex');
	return matrix;
}

export async function invokeSorobanContract(request, { signal } = {}) {
	const span = createSpan('soroban.invoke', {
		'invoke.contract_id': request.contractId,
		'invoke.function_name': request.functionName,
		'invoke.network':
			request.network || process.env.DEFAULT_NETWORK || 'testnet',
		'invoke.request_id': request.requestId,
		'invoke.args_count': Object.keys(request.args || {}).length,
		'invoke.require_auth': request.require_auth === true,
	});

	try {
		const authorizationMatrix = buildAuthorizationMatrix(request);
		setSpanAttributes(span, {
			'invoke.invokers_count': authorizationMatrix.invokers.length,
			'invoke.auth_tree_digest': authorizationMatrix.digest,
		});
		addSpanEvent(span, 'invoke.auth_matrix', {
			'require_auth': authorizationMatrix.require_auth,
			'invokers_count': authorizationMatrix.invokers.length,
		});

		const cliArgs = createCliArgs(request);

		addSpanEvent(span, 'invoke.queued', {
			'queue.length': queue.length,
			'queue.active_count': activeCount,
		});

		const result = await runQueued(
			() =>
				new Promise((resolve, reject) => {
					const startedAt = new Date().toISOString();
					const child = spawnTracked(
						process.env.SOROBAN_CLI || 'soroban',
						cliArgs,
						{
							shell: false,
							windowsHide: true,
							env: injectTraceContext(process.env),
						}
					);

					let stdout = '';
					let stderr = '';
					let finished = false;
					let timeout = null;

					const emit = (status, detail) => {
						const payload = {
							requestId: request.requestId,
							contractId: request.contractId,
							functionName: request.functionName,
							status,
							detail,
							timestamp: new Date().toISOString(),
						};
						invokeProgressBus.emit('progress', payload);
					};

					const cleanup = () => {
						if (timeout) {
							clearTimeout(timeout);
							timeout = null;
						}
						if (signal) {
							signal.removeEventListener('abort', onAbort);
						}
					};

					const complete = (err, result) => {
						if (finished) return;
						finished = true;
						cleanup();

						const durationMs = Date.now() - Date.parse(startedAt);
						setSpanAttributes(span, {
							'invoke.duration_ms': durationMs,
							'invoke.exit_code': err ? err.code || 1 : 0,
						});

						if (err) {
							span.setStatus({ code: 2, message: err.message });
						}

						if (err) {
							reject(err);
						} else {
							resolve(result);
						}
					};

					const onAbort = () => {
						addSpanEvent(span, 'invoke.cancelled');
						terminateChildProcess(child);
						complete(new Error('Invocation cancelled'));
					};

					if (signal) {
						if (signal.aborted) {
							return onAbort();
						}
						signal.addEventListener('abort', onAbort, { once: true });
					}

					timeout = setTimeout(() => {
						addSpanEvent(span, 'invoke.timeout');
						terminateChildProcess(child);
						complete(
							new Error(`Invocation timed out after ${INVOKE_TIMEOUT_MS}ms`)
						);
					}, INVOKE_TIMEOUT_MS);

					emit('invoking', 'spawned soroban CLI');

					child.stdout.on('data', (chunk) => {
						const text = chunk.toString();
						stdout += text;
						emit('executing', text.trim() || 'cli output');
					});

					child.stderr.on('data', (chunk) => {
						const text = chunk.toString();
						stderr += text;
						emit('executing', text.trim() || 'cli stderr');
					});

					child.on('error', (error) => {
						logInvocation({
							startedAt,
							endedAt: new Date().toISOString(),
							request: sanitizeLogRequest(request),
							status: 'failed',
							error: error.message,
						});
						emit('failed', error.message);
						complete(error);
					});

					child.on('close', (code) => {
						const endedAt = new Date().toISOString();
						const output = parseCliOutput(stdout);
						const baseResult = {
							success: code === 0,
							status: code === 0 ? 'success' : 'failed',
							contractId: request.contractId,
							functionName: request.functionName,
							stdout: output.raw,
							parsed: output.parsed,
							stderr: stderr.trim() || undefined,
							startedAt,
							endedAt,
							authorizationMatrix,
						};

						logInvocation({
							startedAt,
							endedAt,
							request: sanitizeLogRequest(request),
							status: baseResult.status,
							code,
							stdout: output.raw,
							stderr: stderr.trim(),
							authorizationMatrixDigest: authorizationMatrix.digest,
						});

						if (code === 0) {
							recordTamperEvidentAuditLog({
								action: 'contract_invoke',
								contractId: request.contractId,
								functionName: request.functionName,
								ledgerSequence: request.ledgerSequence || request.ledger_sequence || output.parsed?.ledgerSequence || 100,
								sessionId: request.sessionId || request.session_id || request.requestId || 'sess-invoke',
								userId: request.userId || request.user_id,
								metadata: { args: request.args, authorizationMatrix },
							}).catch(() => {});

							emit('success', output.parsed ?? output.raw);
							complete(null, baseResult);
							return;
						}

						const error = new Error(
							stderr.trim() || `Soroban CLI exited with code ${code}`
						);
						error.code = code;
						error.stdout = output.raw;
						error.stderr = stderr.trim();
						emit('failed', error.message);
						complete(error);
					});
				})
		);

		return result;
	} finally {
		span.end();
	}
}
