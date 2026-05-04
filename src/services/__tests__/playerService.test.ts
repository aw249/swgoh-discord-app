import { PlayerService } from '../playerService';
import { PlayerStore } from '../../storage/inMemoryStore';

describe('PlayerService', () => {
  let mockStore: jest.Mocked<PlayerStore>;
  let playerService: PlayerService;

  beforeEach(() => {
    mockStore = {
      registerPlayer: jest.fn(),
      getAllyCode: jest.fn(),
      removePlayer: jest.fn(),
      getRegistration: jest.fn()
    };
    playerService = new PlayerService(mockStore);
  });

  describe('registerPlayer', () => {
    it('should register a player with a valid 9-digit ally code', async () => {
      const discordUserId = '123456789';
      const allyCode = '987654321';

      await playerService.registerPlayer(discordUserId, allyCode);

      expect(mockStore.registerPlayer).toHaveBeenCalledWith(discordUserId, allyCode);
    });

    it('should normalise ally code by removing dashes', async () => {
      const discordUserId = '123456789';
      const allyCodeWithDashes = '987-654-321';

      await playerService.registerPlayer(discordUserId, allyCodeWithDashes);

      expect(mockStore.registerPlayer).toHaveBeenCalledWith(discordUserId, '987654321');
    });

    it('should throw an error for invalid ally code format', async () => {
      const discordUserId = '123456789';
      const invalidAllyCode = '12345';

      await expect(
        playerService.registerPlayer(discordUserId, invalidAllyCode)
      ).rejects.toThrow('Invalid ally code format');
    });

    it('should throw an error for non-numeric ally code', async () => {
      const discordUserId = '123456789';
      const invalidAllyCode = 'abc123456';

      await expect(
        playerService.registerPlayer(discordUserId, invalidAllyCode)
      ).rejects.toThrow('Invalid ally code format');
    });
  });

  describe('getAllyCode', () => {
    it('should return ally code for registered player', async () => {
      const discordUserId = '123456789';
      const allyCode = '987654321';
      mockStore.getAllyCode.mockResolvedValue(allyCode);

      const result = await playerService.getAllyCode(discordUserId);

      expect(result).toBe(allyCode);
      expect(mockStore.getAllyCode).toHaveBeenCalledWith(discordUserId);
    });

    it('should return null for unregistered player', async () => {
      const discordUserId = '123456789';
      mockStore.getAllyCode.mockResolvedValue(null);

      const result = await playerService.getAllyCode(discordUserId);

      expect(result).toBeNull();
    });
  });

  describe('isPlayerRegistered', () => {
    it('should return true for registered player', async () => {
      const discordUserId = '123456789';
      mockStore.getAllyCode.mockResolvedValue('987654321');

      const result = await playerService.isPlayerRegistered(discordUserId);

      expect(result).toBe(true);
    });

    it('should return false for unregistered player', async () => {
      const discordUserId = '123456789';
      mockStore.getAllyCode.mockResolvedValue(null);

      const result = await playerService.isPlayerRegistered(discordUserId);

      expect(result).toBe(false);
    });
  });

  describe('getRegistration', () => {
    it('should return registration for a known player', async () => {
      const discordUserId = '123456789';
      const reg = { allyCode: '987654321', registeredAt: '2025-01-01T00:00:00.000Z', legacy: true as true };
      (mockStore.getRegistration as jest.Mock).mockResolvedValue(reg);

      const result = await playerService.getRegistration(discordUserId);

      expect(result).toEqual(reg);
      expect(mockStore.getRegistration).toHaveBeenCalledWith(discordUserId);
    });

    it('should return null for an unregistered player', async () => {
      (mockStore.getRegistration as jest.Mock).mockResolvedValue(null);

      const result = await playerService.getRegistration('unknown');

      expect(result).toBeNull();
    });

    it('should return null when store does not implement getRegistration', async () => {
      const storeWithoutMethod: PlayerStore = {
        registerPlayer: jest.fn(),
        getAllyCode: jest.fn(),
        removePlayer: jest.fn()
      };
      const service = new PlayerService(storeWithoutMethod);

      const result = await service.getRegistration('123');
      expect(result).toBeNull();
    });
  });
});
