import { setupGracefulShutdown } from './shutdown.js';

describe('setupGracefulShutdown', () => {
  let mockServer, mockWss, mockDb, processExitSpy, processOnSpy;

  beforeEach(() => {
    mockServer = { close: jest.fn((cb) => cb()) };
    mockWss = { clients: new Set(), close: jest.fn((cb) => cb()) };
    mockDb = { destroy: jest.fn().mockResolvedValue(true) };

    processExitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
    processOnSpy = jest
      .spyOn(process, 'on')
      .mockImplementation((signal, cb) => cb());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should drain database connections and close socket servers on SIGTERM', async () => {
    setupGracefulShutdown({
      server: mockServer,
      wss: mockWss,
      db: mockDb,
      timeoutMs: 5000,
    });

    // Wait for event loop ticks
    await new Promise((r) => setTimeout(r, 10));

    expect(mockServer.close).toHaveBeenCalled();
    expect(mockWss.close).toHaveBeenCalled();
    expect(mockDb.destroy).toHaveBeenCalled();
    expect(processExitSpy).toHaveBeenCalledWith(0);
  });
});
