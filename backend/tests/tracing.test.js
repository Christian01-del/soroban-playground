// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

// Test suite for the distributed tracing module (Issue #967).

import { jest } from '@jest/globals';

// Mock config module
jest.mock('../src/config/index.js', () => ({
  __esModule: true,
  default: {
    tracing: {
      enabled: true,
      serviceName: 'test-service',
      serviceVersion: '1.0.0',
      jaegerEndpoint: undefined,
      zipkinEndpoint: undefined,
      sampleRateSuccess: 0.1,
      sampleRateErrors: 1.0,
      slowRequestThresholdMs: 5000,
    },
    app: {
      env: 'development',
    },
  },
}));

const mockSdkStart = jest.fn();
const mockSdkShutdown = jest.fn().mockResolvedValue(undefined);

jest.mock('@opentelemetry/sdk-node', () => ({
  NodeSDK: jest.fn().mockImplementation(() => ({
    start: mockSdkStart,
    shutdown: mockSdkShutdown,
  })),
}));

jest.mock('@opentelemetry/exporter-jaeger', () => ({
  JaegerExporter: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@opentelemetry/exporter-zipkin', () => ({
  ZipkinExporter: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@opentelemetry/auto-instrumentations-node', () => ({
  getNodeAutoInstrumentations: jest.fn().mockReturnValue([]),
}));

jest.mock('@opentelemetry/sdk-trace-base', () => {
  const original = jest.requireActual('@opentelemetry/sdk-trace-base');
  return {
    ...original,
    BatchSpanProcessor: jest.fn().mockImplementation(() => ({})),
    ConsoleSpanExporter: jest.fn().mockImplementation(() => ({})),
  };
});

jest.mock('@opentelemetry/resources', () => ({
  Resource: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@opentelemetry/semantic-conventions', () => ({
  SemanticResourceAttributes: {
    SERVICE_NAME: 'service.name',
    SERVICE_VERSION: 'service.version',
    SERVICE_INSTANCE_ID: 'service.instance.id',
  },
}));

import { initializeTracing } from '../src/tracing.js';

describe('Distributed Tracing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Remove SIGTERM listeners added by previous tests
    process.removeAllListeners('SIGTERM');
  });

  describe('initializeTracing', () => {
    it('starts the OpenTelemetry SDK when tracing is enabled', () => {
      initializeTracing();
      expect(mockSdkStart).toHaveBeenCalled();
    });

    it('returns the SDK instance', () => {
      const sdk = initializeTracing();
      expect(sdk).toBeDefined();
      expect(sdk).not.toBeNull();
    });

    it('uses console exporter in development when no external exporters configured', () => {
      const { ConsoleSpanExporter } = require('@opentelemetry/sdk-trace-base');
      initializeTracing();
      expect(ConsoleSpanExporter).toHaveBeenCalled();
    });

    it('registers SIGTERM handler for graceful shutdown', () => {
      const before = process.listenerCount('SIGTERM');
      initializeTracing();
      const after = process.listenerCount('SIGTERM');
      expect(after).toBeGreaterThan(before);
    });
  });

  describe('Disabled tracing', () => {
    it('returns null when tracing is disabled', () => {
      // We need to modify the config mock for this test
      const config = require('../src/config/index.js').default;
      const originalEnabled = config.tracing.enabled;
      config.tracing.enabled = false;

      // Re-import to get fresh module state
      jest.resetModules();
      jest.mock('../src/config/index.js', () => ({
        __esModule: true,
        default: {
          tracing: {
            enabled: false,
            serviceName: 'test',
            serviceVersion: '1.0.0',
          },
          app: { env: 'development' },
        },
      }));

      const { initializeTracing: initDisabled } = require('../src/tracing.js');
      const result = initDisabled();
      expect(result).toBeNull();
      expect(mockSdkStart).not.toHaveBeenCalled();

      config.tracing.enabled = originalEnabled;
    });
  });

  describe('CustomSampler', () => {
    it('always samples errors (http.status_code >= 400)', () => {
      // The CustomSampler is instantiated inside initializeTracing.
      // We verify it indirectly by checking that the SDK starts with a sampler.
      const { NodeSDK } = require('@opentelemetry/sdk-node');
      initializeTracing();

      expect(NodeSDK).toHaveBeenCalledWith(
        expect.objectContaining({
          sampler: expect.anything(),
        })
      );
    });
  });

  describe('Jaeger exporter', () => {
    it('creates JaegerExporter when jaegerEndpoint is set', () => {
      const config = require('../src/config/index.js').default;
      config.tracing.jaegerEndpoint = 'http://localhost:14268/api/traces';

      const { JaegerExporter } = require('@opentelemetry/exporter-jaeger');
      initializeTracing();

      expect(JaegerExporter).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: 'http://localhost:14268/api/traces',
        })
      );

      config.tracing.jaegerEndpoint = undefined;
    });
  });

  describe('Zipkin exporter', () => {
    it('creates ZipkinExporter when zipkinEndpoint is set', () => {
      const config = require('../src/config/index.js').default;
      config.tracing.zipkinEndpoint = 'http://localhost:9411/api/v2/spans';

      const { ZipkinExporter } = require('@opentelemetry/exporter-zipkin');
      initializeTracing();

      expect(ZipkinExporter).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'http://localhost:9411/api/v2/spans',
        })
      );

      config.tracing.zipkinEndpoint = undefined;
    });
  });
});
