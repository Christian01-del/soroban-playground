import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ToastViewport from '../../components/ToastViewport';
import { toastManager } from '../../lib/toastManager';

describe('ToastViewport', () => {
  afterEach(() => act(() => toastManager.clear()));

  it('renders and dismisses notifications from the shared toast manager', () => {
    render(<ToastViewport />);
    act(() => {
      toastManager.show({ title: 'Simulation failed', message: 'RPC rejected the request', type: 'error', durationMs: 0 });
    });
    expect(screen.getByRole('status')).toHaveTextContent('Simulation failed');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss Simulation failed' }));
    return waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  });
});
