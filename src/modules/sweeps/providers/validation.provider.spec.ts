import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { Account } from '../../accounts/entities/account.entity.js';
import { ValidationProvider } from './validation.provider.js';
import { StrKey } from '@stellar/stellar-sdk';
import { AccountStatus } from '../../accounts/enums/account-status.enum.js';

const mockAccount = (overrides: Partial<Account> = {}): Account =>
  ({
    id: 'acc-123',
    publicKey: 'GAB...',
    ephemeralSecret: 'S...',
    status: AccountStatus.PENDING_CLAIM,
    expiresAt: new Date(Date.now() + 86400000),
    amount: '100',
    asset: 'native',
    ...overrides,
  }) as Account;

describe('ValidationProvider', () => {
  let provider: ValidationProvider;
  let repo: Repository<Account>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ValidationProvider,
        {
          provide: getRepositoryToken(Account),
          useClass: Repository,
        },
      ],
    }).compile();

    provider = module.get<ValidationProvider>(ValidationProvider);
    repo = module.get<Repository<Account>>(getRepositoryToken(Account));
    // Mock Stellar address validation to avoid relying on real keys in tests
    jest.spyOn(StrKey, 'isValidEd25519PublicKey').mockReturnValue(true);
  });

  describe('validateSweepParameters', () => {
    const validDto = {
      accountId: 'acc-123',
      ephemeralPublicKey: 'GABC123',
      ephemeralSecret: 'SABC123',
      destinationAddress: 'GD5J6HLF5666X4AZLTFTXGKWDBSUXSWXP6P5F20O1337',
      amount: '100',
      asset: 'native',
    };

    it('should pass validation for valid parameters', async () => {
      jest.spyOn(repo, 'findOne').mockResolvedValue(
        mockAccount({
          publicKey: validDto.ephemeralPublicKey,
          amount: validDto.amount,
        }),
      );

      const realValidG =
        'GBBM6BKZPEHWYO3E3YKRETPKQ5MRNWSKA722GHBMZABXD4F2J33665O';

      const dto = { ...validDto, destinationAddress: realValidG };

      await expect(
        provider.validateSweepParameters(dto),
      ).resolves.not.toThrow();
    });

    it('should throw NotFoundException for non-existent account', async () => {
      jest.spyOn(repo, 'findOne').mockResolvedValue(null);

      const dto = {
        ...validDto,
        destinationAddress:
          'GBBM6BKZPEHWYO3E3YKRETPKQ5MRNWSKA722GHBMZABXD4F2J33665O',
      };

      await expect(provider.validateSweepParameters(dto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException for CLAIMED status', async () => {
      jest.spyOn(repo, 'findOne').mockResolvedValue(
        mockAccount({
          status: AccountStatus.CLAIMED,
          publicKey: validDto.ephemeralPublicKey,
        }),
      );
      const dto = {
        ...validDto,
        destinationAddress:
          'GBBM6BKZPEHWYO3E3YKRETPKQ5MRNWSKA722GHBMZABXD4F2J336650',
      };

      await expect(provider.validateSweepParameters(dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException for EXPIRED status (logic check)', async () => {
      const pastDate = new Date(Date.now() - 10000);
      jest.spyOn(repo, 'findOne').mockResolvedValue(
        mockAccount({
          status: AccountStatus.PENDING_CLAIM,
          expiresAt: pastDate,
          publicKey: validDto.ephemeralPublicKey,
        }),
      );
      const dto = {
        ...validDto,
        destinationAddress:
          'GBBM6BKZPEHWYO3E3YKRETPKQ5MRNWSKA722GHBMZABXD4F2J336650',
      };

      await expect(provider.validateSweepParameters(dto)).rejects.toThrow(
        'Account has expired',
      );
    });

    it('should throw BadRequestException for PENDING_PAYMENT status', async () => {
      jest.spyOn(repo, 'findOne').mockResolvedValue(
        mockAccount({
          status: AccountStatus.PENDING_PAYMENT,
          publicKey: validDto.ephemeralPublicKey,
        }),
      );
      const dto = {
        ...validDto,
        destinationAddress:
          'GBBM6BKZPEHWYO3E3YKRETPKQ5MRNWSKA722GHBMZABXD4F2J336650',
      };

      await expect(provider.validateSweepParameters(dto)).rejects.toThrow(
        'Account has not received payment yet',
      );
    });

    it('should throw BadRequestException for amount mismatch', async () => {
      jest.spyOn(repo, 'findOne').mockResolvedValue(
        mockAccount({
          publicKey: validDto.ephemeralPublicKey,
          amount: '500',
        }),
      );
      const dto = {
        ...validDto,
        destinationAddress:
          'GBBM6BKZPEHWYO3E3YKRETPKQ5MRNWSKA722GHBMZABXD4F2J336650',
      };

      await expect(provider.validateSweepParameters(dto)).rejects.toThrow(
        /Amount mismatch/,
      );
    });

    it('should throw BadRequestException for asset mismatch', async () => {
      jest.spyOn(repo, 'findOne').mockResolvedValue(
        mockAccount({
          publicKey: validDto.ephemeralPublicKey,
          amount: validDto.amount,
          asset: 'USDC:G...',
        }),
      );
      const dto = {
        ...validDto,
        destinationAddress:
          'GBBM6BKZPEHWYO3E3YKRETPKQ5MRNWSKA722GHBMZABXD4F2J336650',
      };

      await expect(provider.validateSweepParameters(dto)).rejects.toThrow(
        /Asset mismatch/,
      );
    });
  });

  describe('canSweep', () => {
    it('should return true for valid sweep conditions', async () => {
      jest.spyOn(repo, 'findOne').mockResolvedValue(mockAccount());
      const result = await provider.canSweep(
        'acc-123',
        'GBBM6BKZPEHWYO3E3YKRETPKQ5MRNWSKA722GHBMZABXD4F2J336650',
      );
      expect(result).toBe(true);
    });

    it('should return false for non-existent account', async () => {
      jest.spyOn(repo, 'findOne').mockResolvedValue(null);
      const result = await provider.canSweep(
        'acc-123',
        'GBBM6BKZPEHWYO3E3YKRETPKQ5MRNWSKA722GHBMZABXD4F2J336650',
      );
      expect(result).toBe(false);
    });

    it('should return false for expired account', async () => {
      jest.spyOn(repo, 'findOne').mockResolvedValue(
        mockAccount({
          expiresAt: new Date(Date.now() - 1000),
        }),
      );
      const result = await provider.canSweep(
        'acc-123',
        'GBBM6BKZPEHWYO3E3YKRETPKQ5MRNWSKA722GHBMZABXD4F2J336650',
      );
      expect(result).toBe(false);
    });

    it('should not throw errors and return false on exception', async () => {
      jest.spyOn(repo, 'findOne').mockRejectedValue(new Error('DB Error'));
      const result = await provider.canSweep(
        'acc-123',
        'GBBM6BKZPEHWYO3E3YKRETPKQ5MRNWSKA722GHBMZABXD4F2J336650',
      );
      expect(result).toBe(false);
    });
  });

  describe('getSweepStatus', () => {
    it('should return canSweep true for valid account', async () => {
      jest.spyOn(repo, 'findOne').mockResolvedValue(mockAccount());
      const result = await provider.getSweepStatus('acc-123');
      expect(result).toEqual({ canSweep: true });
    });

    it('should return "Account not found" for non-existent', async () => {
      jest.spyOn(repo, 'findOne').mockResolvedValue(null);
      const result = await provider.getSweepStatus('acc-123');
      expect(result.reason).toBe('Account not found');
    });

    it('should return "Already swept" for CLAIMED status', async () => {
      jest
        .spyOn(repo, 'findOne')
        .mockResolvedValue(mockAccount({ status: AccountStatus.CLAIMED }));
      const result = await provider.getSweepStatus('acc-123');
      expect(result.reason).toBe('Already swept');
    });
  });
});
