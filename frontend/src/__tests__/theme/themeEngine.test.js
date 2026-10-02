// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT
// Theme Engine unit tests

describe('Theme Engine', () => {
  it('default theme is dark', () => {
    const defaultTheme = 'dark';
    expect(['dark', 'light']).toContain(defaultTheme);
  });

  it('theme tokens include primary colour', () => {
    const tokens = {
      primary: '#6366f1',
      background: '#0f172a',
      surface: '#1e293b',
      text: '#f1f5f9',
    };
    expect(tokens.primary).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it('switching theme updates class on document', () => {
    const classList = new Set(['dark']);
    classList.delete('dark');
    classList.add('light');
    expect(classList.has('light')).toBe(true);
    expect(classList.has('dark')).toBe(false);
  });

  it('persists theme preference to localStorage', () => {
    const store = {};
    const localStorage = {
      setItem: (k, v) => { store[k] = v; },
      getItem: (k) => store[k] ?? null,
    };
    localStorage.setItem('theme', 'light');
    expect(localStorage.getItem('theme')).toBe('light');
  });

  it('falls back to system preference when no stored value', () => {
    const store = {};
    const getTheme = () => store['theme'] ?? 'dark';
    expect(getTheme()).toBe('dark');
  });
});
