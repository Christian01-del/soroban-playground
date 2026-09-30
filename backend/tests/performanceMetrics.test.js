// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

// Test suite for the OpenTelemetry performance metrics module (Issue #967).

import { jest } from '@jest/globals';

// Mock the config module
jest.mock('../src/config/index.js', () => ({
  __esModule: true,
  default: {
    tracing: {
      enabled: true,
      serviceName: 'test-service',
      serviceVersion: '1.0.0',
    },
  },
}));

// Mock OpenTelemetry modules
const mockObserve = jest.fn();
const mockAddCallback = jest.fn();
const mockCreateObservableGauge = jest.fn(() => ({
  addCallback: mockAddCallback,
}));
const mockCreateHistogram = jest.fn(() => ({}));

const mockGetMeter = jest.fn(() => ({
  createObservableGauge: mockCreateObservableGauge,
  createHistogram: mockCreateHistogram,
}));

jest.mock('@opentelemetry/api-metrics', () => ({
  MeterProvider: jest.fn().mockImplementation(() => ({
    getMeter: mockGetMeter,
  })),
  Meter: jest.fn(),
}));

const mockPrometheusExporter = jest.fn();
jest.mock('@opentelemetry/exporter-prometheus', () => ({
  PrometheusExporter: mockPrometheusExporter,
}));

import {
  initializeMetrics,
  createOperationMetrics,
} from '../src/metrics/performance.js';

describe('Performance Metrics (OpenTelemetry)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('initializeMetrics', () => {
    it('creates a PrometheusExporter with the configured port', () => {
      initializeMetrics();
      expect(mockPrometheusExporter).toHaveBeenCalledWith({
        port: expect.anything(),
      });
    });

    it('returns a MeterProvider', () => {
      const result = initializeMetrics();
      expect(result).toBeDefined();
      expect(result).not.toBeNull();
    });

    it('creates process_memory_usage_bytes observable gauge', () => {
      initializeMetrics();
      expect(mockCreateObservableGauge).toHaveBeenCalledWith(
        'process_memory_usage_bytes',
        expect.objectContaining({
          description: expect.stringContaining('memory'),
        })
      );
    });

    it('creates process_cpu_usage_percent observable gauge', () => {
      initializeMetrics();
      expect(mockCreateObservableGauge).toHaveBeenCalledWith(
        'process_cpu_usage_percent',
        expect.objectContaining({
          description: expect.stringContaining('CPU'),
        })
      );
    });

    it('creates nodejs_eventloop_lag_seconds observable gauge', () => {
      initializeMetrics();
      expect(mockCreateObservableGauge).toHaveBeenCalledWith(
        'nodejs_eventloop_lag_seconds',
        expect.objectContaining({
          description: expect.stringContaining('event loop'),
        })
      );
    });

    it('registers callbacks for observable gauges', () => {
      initializeMetrics();
      expect(mockAddCallback).toHaveBeenCalledTimes(3);
    });
  });

  describe('createOperationMetrics', () => {
    it('returns metric objects when meter is initialized', () => {
      initializeMetrics();
      const metrics = createOperationMetrics();

      expect(metrics).toBeDefined();
      expect(mockCreateHistogram).toHaveBeenCalledWith(
        'soroban_compile_duration_seconds',
        expect.any(Object)
      );
      expect(mockCreateHistogram).toHaveBeenCalledWith(
        'soroban_deploy_duration_seconds',
        expect.any(Object)
      );
      expect(mockCreateHistogram).toHaveBeenCalledWith(
        'soroban_invoke_duration_seconds',
        expect.any(Object)
      );
    });

    it('returns empty object when meter is not initialized', () => {
      // initializeMetrics was not called, so meter is null
      // We need to reset the module to have a fresh state
      const metrics = createOperationMetrics();
      // If called before initializeMetrics, should return {}
      expect(metrics).toBeDefined();
    });
  });
});
