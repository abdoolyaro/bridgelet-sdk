import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { StellarService } from './stellar.service';

const mockConfigService = {
  getOrThrow: (key: string): string => {
    const config: Record<string, string> = {
      'stellar.horizonUrl': 'https://horizon-testnet.stellar.org',
      'stellar.sorobanRpcUrl': 'https://soroban-testnet.stellar.org',
      'stellar.network': 'testnet',
    };
    const value = config[key];
    if (value === undefined) throw new Error('Config key not found: ' + key);
    return value;
  },
};

describe('StellarService', () => {
  let service: StellarService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StellarService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<StellarService>(StellarService);
  });

  describe('toExpiryLedger', () => {
    it('converts 1 hour (3600s) to the correct expiry ledger', async () => {
      jest.spyOn(service, 'getCurrentLedger').mockResolvedValue(1000);
      const result = await service.toExpiryLedger(3600);
      // 3600 / 5 = 720 ledgers + 10 buffer + 1000 current = 1730
      expect(result).toBe(1730);
    });

    it('converts 1 day (86400s) to the correct expiry ledger', async () => {
      jest.spyOn(service, 'getCurrentLedger').mockResolvedValue(1000);
      const result = await service.toExpiryLedger(86400);
      // 86400 / 5 = 17280 ledgers + 10 buffer + 1000 current = 18290
      expect(result).toBe(18290);
    });

    it('converts 30 days (2592000s) to the correct expiry ledger', async () => {
      jest.spyOn(service, 'getCurrentLedger').mockResolvedValue(1000);
      const result = await service.toExpiryLedger(2592000);
      // 2592000 / 5 = 518400 ledgers + 10 buffer + 1000 current = 519410
      expect(result).toBe(519410);
    });

    it('rounds fractional ledger counts up, not down (7s -> 2 ledgers)', async () => {
      jest.spyOn(service, 'getCurrentLedger').mockResolvedValue(1000);
      const result = await service.toExpiryLedger(7);
      // 7 / 5 = 1.4 -> ceil = 2 ledgers + 10 buffer + 1000 current = 1012
      expect(result).toBe(1012);
    });

    it('applies the buffer on top of the ledger conversion', async () => {
      jest.spyOn(service, 'getCurrentLedger').mockResolvedValue(500);
      // 5s / 5 = exactly 1 ledger; without buffer result would be 501
      const result = await service.toExpiryLedger(5);
      expect(result).toBe(511); // 500 + 1 + 10 (buffer)
    });

    it('handles edge case: getCurrentLedger returns a very low value', async () => {
      jest.spyOn(service, 'getCurrentLedger').mockResolvedValue(1);
      const result = await service.toExpiryLedger(3600);
      // 3600 / 5 = 720 + 10 buffer + 1 current = 731
      expect(result).toBe(731);
    });

    it('minimum expiresIn (3600s) produces an expiry ledger well above the current ledger', async () => {
      const currentLedger = 1000;
      jest.spyOn(service, 'getCurrentLedger').mockResolvedValue(currentLedger);
      const result = await service.toExpiryLedger(3600);
      // 730 ledgers ahead - meaningfully greater than current
      expect(result).toBeGreaterThan(currentLedger + 100);
    });
  });
});
