import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ErrorBoundary, createDiagnosticLog, describeUnknownError } from '../../components/ErrorBoundary';
import { toastManager } from '../../lib/toastManager';

jest.mock('../../lib/toastManager', () => ({
  toastManager: { show: jest.fn(), dismiss: jest.fn() },
}));

const ProblemChild = ({ shouldThrow = false }: { shouldThrow?: boolean }) => {
  if (shouldThrow) throw new Error('Test crash in child component');
  return <div>Healthy Component</div>;
};

describe('ErrorBoundary', () => {
  const originalError = console.error;
  beforeEach(() => {
    console.error = jest.fn();
    jest.clearAllMocks();
  });
  afterAll(() => {
    console.error = originalError;
  });

  it('renders children normally without logging or notifying', () => {
    render(<ErrorBoundary><ProblemChild /></ErrorBoundary>);
    expect(screen.getByText('Healthy Component')).toBeInTheDocument();
    expect(toastManager.show).not.toHaveBeenCalled();
  });

  it('isolates a child render failure and records structured diagnostics', () => {
    const onLogError = jest.fn();
    render(<ErrorBoundary onLogError={onLogError}><ProblemChild shouldThrow /></ErrorBoundary>);

    expect(screen.getByRole('alert')).toHaveTextContent('Test crash in child component');
    expect(onLogError).toHaveBeenCalledWith(expect.objectContaining({
      error: 'Test crash in child component',
      name: 'Error',
      level: 'global',
      timestamp: expect.any(String),
    }));
    expect(toastManager.show).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', priority: 'high' }));
  });

  it('recovers after the child stops throwing', () => {
    function Harness() {
      const [throwing, setThrowing] = useState(true);
      return <>
        <button onClick={() => setThrowing(false)}>Stop throwing</button>
        <ErrorBoundary><ProblemChild shouldThrow={throwing} /></ErrorBoundary>
      </>;
    }

    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Stop throwing' }));
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
    expect(screen.getByText('Healthy Component')).toBeInTheDocument();
  });

  it('renders a supplied fallback without exposing diagnostic controls', () => {
    render(<ErrorBoundary fallback={<div>Safe fallback</div>}><ProblemChild shouldThrow /></ErrorBoundary>);
    expect(screen.getByText('Safe fallback')).toBeInTheDocument();
    expect(screen.queryByText('Export Crash Diagnostics')).not.toBeInTheDocument();
  });

  it('exports diagnostics as a JSON download when requested', () => {
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    const createObjectURL = jest.fn(() => 'blob:test');
    const revokeObjectURL = jest.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    render(<ErrorBoundary><ProblemChild shouldThrow /></ErrorBoundary>);
    fireEvent.click(screen.getByRole('button', { name: 'Export Crash Diagnostics' }));
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(click).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test');
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: originalCreate });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: originalRevoke });
    click.mockRestore();
  });
});

describe('ErrorBoundary diagnostics', () => {
  it('normalizes unknown and Soroban-style thrown values without leaking secrets', () => {
    expect(describeUnknownError('rpc failed')).toMatchObject({ name: 'ThrownValue', message: 'rpc failed' });
    const described = describeUnknownError({ name: 'RpcError', message: 'simulation failed', token: 'secret-token', result: { code: -1 } });
    expect(described).toMatchObject({ name: 'RpcError', message: 'simulation failed' });
    expect(described.details).not.toHaveProperty('token');
  });

  it('includes component context and strips query data from exported URLs', () => {
    window.history.pushState({}, '', '/playground?access_token=secret#details');
    const log = createDiagnosticLog(new Error('boom'), { componentStack: '\n at SimulationPanel' } as React.ErrorInfo, 'widget', new Date('2026-01-02T03:04:05.000Z'));
    expect(log).toMatchObject({ error: 'boom', componentStack: '\n at SimulationPanel', level: 'widget', timestamp: '2026-01-02T03:04:05.000Z', url: expect.stringContaining('/playground') });
    expect(log.url).not.toContain('access_token');
    expect(log.url).not.toContain('details');
  });
});
