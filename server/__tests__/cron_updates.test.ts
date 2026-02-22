import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkGameUpdates } from '../cron.js';
import { storage } from '../storage.js';
import { igdbClient } from '../igdb.js';
import type { Game } from '../../shared/schema.js';

// Mock dependencies
vi.mock('../storage.js', () => ({
  storage: {
    getAllGames: vi.fn(),
    updateGame: vi.fn(),
    updateGamesBatch: vi.fn(),
    addNotification: vi.fn(),
    addNotificationsBatch: vi.fn(),
  }
}));

vi.mock('../igdb.js', () => ({
  igdbClient: {
    getGamesByIds: vi.fn(),
  }
}));

vi.mock('../logger.js', () => ({
  igdbLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }
}));

vi.mock('../socket.js', () => ({
  notifyUser: vi.fn(),
}));

describe('checkGameUpdates', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should batch updates for multiple games', async () => {
    // Set a fixed date for the test
    const mockNow = new Date('2023-06-01T00:00:00Z');
    vi.setSystemTime(mockNow);

    // Setup test data
    const mockGames: Partial<Game>[] = [
      {
        id: 'game-1',
        title: 'Game 1',
        igdbId: 1001,
        releaseDate: '2023-01-01',
        releaseStatus: 'upcoming', // Should change to released (past date)
        originalReleaseDate: '2023-01-01',
      },
      {
        id: 'game-2',
        title: 'Game 2',
        igdbId: 1002,
        releaseDate: '2099-01-01', // Far future
        releaseStatus: 'released', // Should change to upcoming (future date)
        originalReleaseDate: '2099-01-01',
      },
      {
        id: 'game-3',
        title: 'Game 3',
        igdbId: 1003,
        releaseDate: '2023-01-01',
        releaseStatus: 'released',
        originalReleaseDate: '2023-01-01',
      }
    ];

    vi.mocked(storage.getAllGames).mockResolvedValue(mockGames as Game[]);

    // Mock IGDB response
    const mockIgdbGames = [
      {
        id: 1001,
        first_release_date: Math.floor(new Date('2023-01-01').getTime() / 1000),
      },
      {
        id: 1002,
        first_release_date: Math.floor(new Date('2099-01-01').getTime() / 1000),
      },
      {
        id: 1003,
        first_release_date: Math.floor(new Date('2023-01-01').getTime() / 1000),
      }
    ];
    vi.mocked(igdbClient.getGamesByIds).mockResolvedValue(mockIgdbGames as any);

    // Mock batch notification return
    vi.mocked(storage.addNotificationsBatch).mockResolvedValue([{ id: 'notif-1', title: 'Game Released' }] as any);

    // Run the function
    await checkGameUpdates();

    const updateGameCalls = vi.mocked(storage.updateGame).mock.calls;
    const batchCalls = vi.mocked(storage.updateGamesBatch).mock.calls;
    const notificationCalls = vi.mocked(storage.addNotification).mock.calls;
    const batchNotificationCalls = vi.mocked(storage.addNotificationsBatch).mock.calls;

    // Verify batching optimization
    expect(updateGameCalls.length).toBe(0);
    expect(batchCalls.length).toBe(1);

    // Verify batch content
    const updates = batchCalls[0][0]; // First argument of first call
    expect(updates).toHaveLength(2); // Game 1 and Game 2 updates

    const game1Update = updates.find((u) => u.id === 'game-1');
    const game2Update = updates.find((u) => u.id === 'game-2');

    expect(game1Update).toBeDefined();
    expect(game1Update?.data.releaseStatus).toBe('released');

    expect(game2Update).toBeDefined();
    expect(game2Update?.data.releaseStatus).toBe('upcoming');

    // Verify notifications
    expect(notificationCalls.length).toBe(0); // Should use batch
    expect(batchNotificationCalls.length).toBe(1);

    const notifications = batchNotificationCalls[0][0];
    expect(notifications).toHaveLength(1); // Only Game 1 released notification
    expect(notifications[0]).toMatchObject({
        title: 'Game Released',
        message: expect.stringContaining('Game 1')
    });
  });
});
