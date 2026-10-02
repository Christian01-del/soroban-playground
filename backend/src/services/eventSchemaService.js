import {
  eventQuarantineSize,
  eventSchemaBreakingChangesTotal,
  eventSchemaDetectionAlertsTotal,
  eventSchemaVersionEventsTotal,
  eventValidationTotal,
} from '../routes/metrics.js';

const MAX_ACCEPTED_EVENTS = 500;
const SUPPORTED_FIELD_TYPES = new Set([
  'any',
  'array',
  'boolean',
  'integer',
  'number',
  'object',
  'string',
  'address',
  'iso_datetime',
]);

const MAX_QUARANTINE_ITEMS = 500;
const MAX_SCHEMA_ALERTS = 200;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function nowIso() {
  return new Date().toISOString();
}

function parseVersion(version) {
  return String(version || '1.0.0')
    .split('.')
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] || 0) - (right[index] || 0);
    if (diff !== 0) {
      return diff;
    }
  }

  return 0;
}

function versionKey(eventType, version) {
  return `${eventType}@${version}`;
}

function fieldTypeForValue(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'any';
  if (Number.isInteger(value)) return 'integer';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'object') return 'object';
  return 'any';
}

function normalizeFieldDefinition(name, definition = {}) {
  const field =
    typeof definition === 'string' ? { type: definition } : { ...definition };
  const type = String(field.type || 'any').toLowerCase();

  return {
    name,
    type: SUPPORTED_FIELD_TYPES.has(type) ? type : 'any',
    required: Boolean(field.required),
    deprecated: Boolean(field.deprecated),
    description: field.description || '',
    nullable: Boolean(field.nullable),
    default: field.default,
    enum: Array.isArray(field.enum) ? [...field.enum] : undefined,
    pattern: field.pattern,
    min: field.min,
    max: field.max,
    minLength: field.minLength,
    maxLength: field.maxLength,
  };
}

function normalizeFields(fields, required = [], deprecatedFields = []) {
  const normalized = {};
  const requiredSet = new Set(required);
  const deprecatedSet = new Set(deprecatedFields);

  if (Array.isArray(fields)) {
    for (const field of fields) {
      if (!field || typeof field !== 'object' || !field.name) {
        continue;
      }
      const normalizedField = normalizeFieldDefinition(field.name, field);
      normalizedField.required =
        normalizedField.required || requiredSet.has(field.name);
      normalizedField.deprecated =
        normalizedField.deprecated || deprecatedSet.has(field.name);
      normalized[field.name] = normalizedField;
    }
    return normalized;
  }

  for (const [name, definition] of Object.entries(fields || {})) {
    const normalizedField = normalizeFieldDefinition(name, definition);
    normalizedField.required =
      normalizedField.required || requiredSet.has(name);
    normalizedField.deprecated =
      normalizedField.deprecated || deprecatedSet.has(name);
    normalized[name] = normalizedField;
  }

  for (const field of requiredSet) {
    if (normalized[field]) {
      normalized[field].required = true;
    }
  }

  for (const field of deprecatedSet) {
    if (normalized[field]) {
      normalized[field].deprecated = true;
    }
  }

  return normalized;
}

function normalizeSchema(input, registeredBy = 'system') {
  const eventType = input.eventType || input.event_type || input.type;
  const version = String(input.version || input.schemaVersion || '1.0.0');
  const fields = normalizeFields(
    input.fields || {},
    input.required || input.requiredFields || input.required_fields || [],
    input.deprecatedFields || input.deprecated_fields || []
  );

  const required = Object.values(fields)
    .filter((field) => field.required)
    .map((field) => field.name);
  const deprecatedFields = Object.values(fields)
    .filter((field) => field.deprecated)
    .map((field) => field.name);

  return {
    eventType,
    version,
    description: input.description || '',
    status: input.status || 'active',
    fields,
    required,
    deprecatedFields,
    additionalProperties: input.additionalProperties !== false,
    migrations: Array.isArray(input.migrations) ? clone(input.migrations) : [],
    createdAt: input.createdAt || nowIso(),
    registeredBy,
  };
}

function validateSchemaDefinition(schema) {
  const errors = [];

  if (!schema.eventType || typeof schema.eventType !== 'string') {
    errors.push('eventType is required');
  }

  if (!schema.version || typeof schema.version !== 'string') {
    errors.push('version is required');
  }

  if (!schema.fields || Object.keys(schema.fields).length === 0) {
    errors.push('fields must define at least one payload field');
  }

  for (const [fieldName, field] of Object.entries(schema.fields || {})) {
    if (!SUPPORTED_FIELD_TYPES.has(field.type)) {
      errors.push(`fields.${fieldName}.type is not supported`);
    }
    if (field.pattern) {
      try {
        new RegExp(field.pattern);
      } catch {
        errors.push(`fields.${fieldName}.pattern must be a valid RegExp`);
      }
    }
  }

  return errors;
}

function isCompatibleTypeChange(fromType, toType) {
  if (fromType === toType) return true;
  if (fromType === 'integer' && toType === 'number') return true;
  if (toType === 'any') return true;
  return false;
}

function analyzeEvolution(previousSchema, nextSchema) {
  if (!previousSchema) {
    return {
      compatible: true,
      breakingChanges: [],
      compatibleChanges: ['Initial schema version'],
      warnings: [],
      migrationGuide: [
        'No prior schema exists. Register this as the baseline.',
      ],
    };
  }

  const breakingChanges = [];
  const compatibleChanges = [];
  const warnings = [];
  const previousFields = previousSchema.fields || {};
  const nextFields = nextSchema.fields || {};

  for (const [name, previousField] of Object.entries(previousFields)) {
    const nextField = nextFields[name];
    if (!nextField) {
      if (previousField.required || !previousField.deprecated) {
        breakingChanges.push(`Removed field "${name}"`);
      } else {
        compatibleChanges.push(`Removed previously deprecated field "${name}"`);
      }
      continue;
    }

    if (!isCompatibleTypeChange(previousField.type, nextField.type)) {
      breakingChanges.push(
        `Changed field "${name}" type from ${previousField.type} to ${nextField.type}`
      );
    }

    if (previousField.required && !nextField.required) {
      compatibleChanges.push(`Made required field "${name}" optional`);
    }

    if (
      !previousField.required &&
      nextField.required &&
      nextField.default === undefined
    ) {
      breakingChanges.push(
        `Made optional field "${name}" required without a default`
      );
    }

    if (!previousField.deprecated && nextField.deprecated) {
      compatibleChanges.push(`Deprecated field "${name}"`);
    }

    if (
      Array.isArray(nextField.enum) &&
      (!Array.isArray(previousField.enum) ||
        nextField.enum.some((value) => !previousField.enum.includes(value)))
    ) {
      warnings.push(
        `Field "${name}" enum changed; verify downstream consumers`
      );
    }
  }

  for (const [name, nextField] of Object.entries(nextFields)) {
    if (previousFields[name]) {
      continue;
    }

    if (nextField.required && nextField.default === undefined) {
      breakingChanges.push(`Added required field "${name}" without a default`);
    } else {
      compatibleChanges.push(
        nextField.required
          ? `Added required field "${name}" with a default`
          : `Added optional field "${name}"`
      );
    }
  }

  if (
    previousSchema.additionalProperties &&
    nextSchema.additionalProperties === false
  ) {
    breakingChanges.push('Changed additionalProperties from true to false');
  }

  const migrationGuide =
    breakingChanges.length > 0
      ? breakingChanges.map((change) => `Resolve: ${change}`)
      : [
          'No breaking payload changes detected.',
          'Consumers can continue reading older events through the migration layer.',
        ];

  return {
    compatible: breakingChanges.length === 0,
    breakingChanges,
    compatibleChanges,
    warnings,
    migrationGuide,
  };
}

function normalizeEventEnvelope(input) {
  const source =
    input?.event && typeof input.event === 'object' ? input.event : input;
  const event = source || {};
  const eventType = event.eventType || event.event_type || event.type;
  const schemaVersion =
    event.schemaVersion || event.schema_version || event.version || undefined;
  const payload =
    event.payload && typeof event.payload === 'object'
      ? event.payload
      : event.data && typeof event.data === 'object'
        ? event.data
        : event.body && typeof event.body === 'object'
          ? event.body
          : undefined;

  return {
    id: event.id || event.eventId || event.event_id || undefined,
    eventType,
    schemaVersion,
    emittedAt: event.emittedAt || event.emitted_at || event.timestamp,
    contractId: event.contractId || event.contract_id,
    payload,
    raw: event,
  };
}

function validateType(value, field) {
  if (value === null || value === undefined) {
    return field.nullable || !field.required;
  }

  switch (field.type) {
    case 'any':
      return true;
    case 'array':
      return Array.isArray(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'integer':
      return Number.isInteger(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'object':
      return typeof value === 'object' && !Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'address':
      return typeof value === 'string' && /^[CG][A-Z0-9]{55}$/.test(value);
    case 'iso_datetime':
      return typeof value === 'string' && !Number.isNaN(Date.parse(value));
    default:
      return true;
  }
}

function buildFieldConstraintErrors(field, value, path) {
  const errors = [];

  if (field.enum && !field.enum.includes(value)) {
    errors.push(`${path} must be one of: ${field.enum.join(', ')}`);
  }

  if (typeof value === 'number') {
    if (field.min !== undefined && value < field.min) {
      errors.push(`${path} must be greater than or equal to ${field.min}`);
    }
    if (field.max !== undefined && value > field.max) {
      errors.push(`${path} must be less than or equal to ${field.max}`);
    }
  }

  if (typeof value === 'string') {
    if (field.minLength !== undefined && value.length < field.minLength) {
      errors.push(`${path} must be at least ${field.minLength} characters`);
    }
    if (field.maxLength !== undefined && value.length > field.maxLength) {
      errors.push(`${path} must be at most ${field.maxLength} characters`);
    }
    if (field.pattern && !new RegExp(field.pattern).test(value)) {
      errors.push(`${path} does not match the required pattern`);
    }
  }

  return errors;
}

function createDefaultSchemas() {
  const legacyFields = {
    paymentId: { type: 'string', required: true },
    payer: { type: 'address', required: true },
    payee: { type: 'address', required: true },
    amount: { type: 'number', required: true, min: 0 },
    asset: { type: 'string', required: true },
    createdAt: { type: 'iso_datetime', required: true },
    status: {
      type: 'string',
      required: true,
      enum: ['pending', 'settled', 'failed'],
    },
  };

  const latestFields = {
    paymentId: { type: 'string', required: true },
    sourceAccount: { type: 'address', required: true },
    destinationAccount: { type: 'address', required: true },
    amount: { type: 'number', required: true, min: 0 },
    asset: { type: 'string', required: true },
    createdAt: { type: 'iso_datetime', required: true },
    status: {
      type: 'string',
      required: true,
      enum: ['pending', 'settled', 'failed'],
    },
    memo { type: 'string', required: false },
  };

  return [
    normalizeSchema({
      eventType: 'payment_created',
      version: '1.0.0',
      description: 'Legacy payment creation event',
      fields: legacyFields,
    }),
    normalizeSchema({
      eventType: 'payment_created',
      version: '2.0.0',
      description: 'Payment creation event with explicit account fields',
      fields: latestFields,
    }),
  ];
}

class EventSchemaService {
  constructor() {
    this.schemas = new Map();
    this.quarantine = [];
    this.alerts = [];
    this.acceptedEvents = [];
    this.validationStats = {
      total: 0,
      valid: 0,
      invalid: 0,
      quarantined: 0,
    };

    for (const schema of createDefaultSchemas()) {
      this.schemas.set(versionKey(schema.eventType, schema.version), schema);
    }
  }

  registerSchema(input, registeredBy = 'system') {
    const schema = normalizeSchema(input, registeredBy);
    const errors = validateSchemaDefinition(schema);
    if (errors.length > 0) {
      const error = new Error(`Invalid schema: ${errors.join('; ')}`);
      error.details = errors;
      throw error;
    }

    const key = versionKey(schema.eventType, schema.version);
    const previous = this.getLatestSchema(schema.eventType);
    const evolution = analyzeEvolution(previous, schema);

    this.schemas.set(key, schema);
    eventSchemaVersionEventsTotal.inc();
    if (!evolution.compatible) {
      eventSchemaBreakingChangesTotal.inc(evolution.breakingChanges.length);
    }

    return { schema, evolution };
  }

  getSchema(eventType, version) {
    return this.schemas.get(versionKey(eventType, version)) || null;
  }

  getLatestSchema(eventType) {
    const candidates = [];
    for (const schema of this.schemas.values()) {
      if (schema.eventType === eventType) {
        candidates.push(schema);
      }
    }

    if (candidates.length === 0) {
      return null;
    }

    candidates.sort((a, b) => compareVersions(b.version, a.version));
    return candidates[0];
  }

  listSchemas(eventType) {
    const all = Array.from(this.schemas.values());
    const filtered = eventType
      ? all.filter((schema) => schema.eventType === eventType)
      : all;

    return filtered.sort((a, b) => {
      if (a.eventType === b.eventType) {
        return compareVersions(b.version, a.version);
      }
      return a.eventType.localeCompare(b.eventType);
    });
  }

  validateEvent(input, options = {}) {
    const envelope = normalizeEventEnvelope(input);
    const errors = [];
    const warnings = [];
    const eventType = envelope.eventType;

    this.validationStats.total += 1;

    if (!eventType) {
      errors.push('eventType is required');
    }

    const schema = eventType
      ? envelope.schemaVersion
        ? this.getSchema(eventType, envelope.schemaVersion)
        : this.getLatestSchema(eventType)
      : null;

    if (eventType && !schema) {
      errors.push(
        envelope.schemaVersion
          ? `No schema registered for ${eventType}@${envelope.schemaVersion}`
          : `No schema registered for ${eventType}`
      );
    }

    if (schema) {
      const payload = envelope.payload || {};
      const knownFields = new Set(Object.keys(schema.fields));

      for (const [name, field] of Object.entries(schema.fields)) {
        const value = payload[name];
        const path = `payload.${name}`;

        if (value === undefined) {
          if (field.required && field.default === undefined) {
            errors.push(`${path} is required`);
          }
          continue;
        }

        if (!validateType(value, field)) {
          errors.push(`${path} must be of type ${field.type}`);
          continue;
        }

        errors.push(...buildFieldConstraintErrors(field, value, path));

        if (field.deprecated) {
          warnings.push(`${path} is deprecated`);
        }
      }

      if (!schema.additionalProperties) {
        for (const name of Object.keys(payload)) {
          if (!knownFields.has(name)) {
            errors.push(`payload.${name} is not allowed`);
          }
        }
      }
    }

    const valid = errors.length === 0;
    if (valid) {
      this.validationStats.valid += 1;
      this.acceptedEvents.push({
        envelope,
        schemaKey: schema ? versionKey(schema.eventType, schema.version) : null,
        validatedAt: nowIso(),
      });
      if (this.acceptedEvents.length > MAX_ACCEPTED_EVENTS) {
        this.acceptedEvents.shift();
      }
    } else {
      this.validationStats.invalid += 1;
    }

    if (options.quarantineOnFailure && !valid) {
      this.quarantineEvent(envelope, errors);
    }

    eventValidationTotal.inc({ status: valid ? 'valid' : 'invalid' });

    return {
      valid,
      errors,
      warnings,
      schema,
      envelope,
    };
  }

  quarantineEvent(envelope, errors) {
    const item = {
      id: envelope.id || `quarantine-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      eventType: envelope.eventType,
      schemaVersion: envelope.schemaVersion,
      errors,
      payload: envelope.payload,
      quarantinedAt: nowIso(),
    };

    this.quarantine.unshift(item);
    if (this.quarantine.length > MAX_QUARANTINE_ITEMS) {
      this.quarantine.pop();
    }

    this.validationStats.quarantined += 1;
    eventQuarantineSize.set(this.quarantine.length);
    return item;
  }

  listQuarantine() {
    return this.quarantine.map((item) => clone(item));
  }

  releaseQuarantine(id) {
    const index = this.quarantine.findIndex((item) => item.id === id);
    if (index === -1) {
      return null;
    }
    const [item] = this.quarantine.splice(index, 1);
    eventQuarantineSize.set(this.quarantine.length);
    return item;
  }

  recordSchemaAlert(alert) {
    const entry = {
      id: alert.id || `alert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: alert.type || 'schema_drift',
      eventType: alert.eventType,
      severity: alert.severity || 'warning',
      message: alert.message || 'Schema drift detected',
      details: alert.details || {},
      createdAt: nowIso(),
    };

    this.alerts.unshift(entry);
    if (this.alerts.length > MAX_SCHEMA_ALERTS) {
      this.alerts.pop();
    }

    eventSchemaDetectionAlertsTotal.inc({ type: entry.type, severity: entry.severity });
    return entry;
  }

  listAlerts() {
    return this.alerts.map((alert) => clone(alert));
  }

  getStats() {
    return {
      schemaCount: this.schemas.size,
      quarantineCount: this.quarantine.length,
      alertCount: this.alerts.length,
      acceptedEventCount: this.acceptedEvents.length,
      validationStats: { ...this.validationStats },
    };
  }

  getAcceptedEvents() {
    return this.acceptedEvents.map((entry) => clone(entry));
  }
}

const eventSchemaService = new EventSchemaService();

export {
  EventSchemaService,
  eventSchemaService,
  normalizeSchema,
  normalizeEventEnvelope,
  analyzeEvolution,
  validateSchemaDefinition,
  compareVersions,
  fieldTypeForValue,
};
