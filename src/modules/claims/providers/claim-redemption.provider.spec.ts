import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { ClaimRedemptionProvider } from './claim-redemption.provider.js';
import { TokenVerificationProvider } from './token-verification.provider.js';
import { Claim } from '../entities/claim.entity.js';
import { Account } from '../../accounts/entities/account.entity.js';
import { SweepsService } from '../../sweeps/sweeps.service.js';
import { AccountStatus } from '../../accounts/enums/account-status.enum.js';

describe('ClaimRedemptionProvider', () => {
  let provider: ClaimRedemptionProvider;

  const mockClaimsRepository = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
  };

  const mockAccountsRepository = {
    findOne: jest.fn(),
    save: jest.fn(),
  };

  const mockTokenVerificationProvider = {
    verifyClaimToken: jest.fn(),
  };

  const mockSweepsService = {
    executeSweep: jest.fn(),
  };

  // A valid 56-character Stellar address starting with 'G'
  const VALID_DESTINATION =
    'GDEST47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA';
  const VALID_TOKEN = 'valid.jwt.token';

  // secretKeyEncrypted is base64-encoded so that decryptSecret() returns 'test-secret'
  const mockAccount: Partial<Account> = {
    id: 'account-uuid-1234',
    publicKey: 'GPUBKEY47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLL',
    secretKeyEncrypted: Buffer.from('test-secret').toString('base64'),
    claimTokenHash: 'mock-token-hash',
    amount: '100.0000000',
    asset: 'native',
    status: AccountStatus.PENDING_CLAIM,
    expiresAt: new Date(Date.now() + 86_400_000),
    metadata: { userId: 'user-123' },
    destinationAddress: '',
    claimedAt: null,
  };

  const mockSweepResult = {
    txHash: 'sweep-tx-hash-abc123',
    success: true,
  };

  const mockClaim: Partial<Claim> = {
    id: 'claim-uuid-5678',
    accountId: mockAccount.id,
    destinationAddress: VALID_DESTINATION,
    sweepTxHash: mockSweepResult.txHash,
    amountSwept: mockAccount.amount,
    asset: mockAccount.asset,
    claimedAt: new Date('2026-02-19T10:00:00.000Z'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClaimRedemptionProvider,
        {
          provide: getRepositoryToken(Claim),
          useValue: mockClaimsRepository,
        },
        {
          provide: getRepositoryToken(Account),
          useValue: mockAccountsRepository,
        },
        {
          provide: TokenVerificationProvider,
          useValue: mockTokenVerificationProvider,
        },
        {
          provide: SweepsService,
          useValue: mockSweepsService,
        },
      ],
    }).compile();

    provider = module.get<ClaimRedemptionProvider>(ClaimRedemptionProvider);

    // Default happy-path mocks shared across tests
    mockTokenVerificationProvider.verifyClaimToken.mockResolvedValue({
      valid: true,
      accountId: mockAccount.id,
      amount: mockAccount.amount,
      asset: mockAccount.asset,
      expiresAt: mockAccount.expiresAt,
    });
    mockAccountsRepository.findOne.mockResolvedValue({ ...mockAccount });
    mockAccountsRepository.save.mockResolvedValue(undefined);
    mockSweepsService.executeSweep.mockResolvedValue(mockSweepResult);
    mockClaimsRepository.create.mockReturnValue({ ...mockClaim });
    mockClaimsRepository.save.mockResolvedValue({ ...mockClaim });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('redeemClaim - successful redemption', () => {
    it('should successfully redeem claim and execute sweep', async () => {
      const result = await provider.redeemClaim(VALID_TOKEN, VALID_DESTINATION);

      expect(result).toEqual({
        success: true,
        txHash: mockSweepResult.txHash,
        amountSwept: mockAccount.amount,
        asset: mockAccount.asset,
        destination: VALID_DESTINATION,
        sweptAt: expect.any(Date),
      });
    });

    it('should create claim record with correct data after a successful sweep', async () => {
      await provider.redeemClaim(VALID_TOKEN, VALID_DESTINATION);

      // Verifies that the claim entity was constructed with the right fields before being persisted
      expect(mockClaimsRepository.create).toHaveBeenCalledWith({
        accountId: mockAccount.id,
        destinationAddress: VALID_DESTINATION,
        sweepTxHash: mockSweepResult.txHash,
        amountSwept: mockAccount.amount,
        asset: mockAccount.asset,
        claimedAt: expect.any(Date),
      });
      expect(mockClaimsRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ accountId: mockAccount.id }),
      );
    });

    it('should update account status to CLAIMED before executing the sweep', async () => {
      await provider.redeemClaim(VALID_TOKEN, VALID_DESTINATION);

      // The account must be marked CLAIMED (with destination and timestamp) to prevent
      // concurrent claim attempts before the sweep is executed
      expect(mockAccountsRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: AccountStatus.CLAIMED,
          destinationAddress: VALID_DESTINATION,
          claimedAt: expect.any(Date),
        }),
      );
    });

    it('should call SweepsService.executeSweep with correct parameters', async () => {
      await provider.redeemClaim(VALID_TOKEN, VALID_DESTINATION);

      expect(mockSweepsService.executeSweep).toHaveBeenCalledWith({
        accountId: mockAccount.id,
        ephemeralPublicKey: mockAccount.publicKey,
        ephemeralSecret: 'test-secret',
        destinationAddress: VALID_DESTINATION,
        amount: mockAccount.amount,
        asset: mockAccount.asset,
      });
    });

    it('should decrypt ephemeral secret via base64 decode before passing to sweep', async () => {
      // The decryptSecret method decodes base64 — 'test-secret' encoded becomes 'test-secret' decoded
      await provider.redeemClaim(VALID_TOKEN, VALID_DESTINATION);

      expect(mockSweepsService.executeSweep).toHaveBeenCalledWith(
        expect.objectContaining({
          ephemeralSecret: 'test-secret',
        }),
      );
    });
  });

  describe('redeemClaim - idempotency for already-claimed accounts', () => {
    it('should return idempotent response when account status is already CLAIMED (race condition guard)', async () => {
      // Simulates a race condition where the account was claimed between token verification
      // and the status check — the provider should return the existing claim without error
      const claimedAccount = { ...mockAccount, status: AccountStatus.CLAIMED };
      const existingClaim = { ...mockClaim, sweepTxHash: 'existing-tx-hash' };

      mockAccountsRepository.findOne.mockResolvedValue(claimedAccount);
      mockClaimsRepository.findOne.mockResolvedValue(existingClaim);

      const result = await provider.redeemClaim(VALID_TOKEN, VALID_DESTINATION);

      expect(result).toEqual({
        success: true,
        txHash: existingClaim.sweepTxHash,
        amountSwept: existingClaim.amountSwept,
        asset: existingClaim.asset,
        destination: existingClaim.destinationAddress,
        sweptAt: existingClaim.claimedAt,
        message: 'Claim was already redeemed',
      });
    });

    it('should handle ConflictException from token verification and return existing claim data', async () => {
      // TokenVerificationProvider throws ConflictException when the account is in CLAIMED status.
      // The provider catches this, looks up the account and claim by token hash, and returns
      // the existing claim rather than propagating the error.
      const claimedAccount = { ...mockAccount, status: AccountStatus.CLAIMED };
      const existingClaim = { ...mockClaim, sweepTxHash: 'conflict-tx-hash' };

      mockTokenVerificationProvider.verifyClaimToken.mockRejectedValue(
        new ConflictException('Claim has already been redeemed'),
      );
      mockAccountsRepository.findOne.mockResolvedValue(claimedAccount);
      mockClaimsRepository.findOne.mockResolvedValue(existingClaim);

      const result = await provider.redeemClaim(VALID_TOKEN, VALID_DESTINATION);

      expect(result).toEqual({
        success: true,
        txHash: existingClaim.sweepTxHash,
        amountSwept: existingClaim.amountSwept,
        asset: existingClaim.asset,
        destination: existingClaim.destinationAddress,
        sweptAt: existingClaim.claimedAt,
        message: 'Claim was already redeemed',
      });
    });
  });

  describe('redeemClaim - Stellar address validation', () => {
    it('should throw BadRequestException for an address with invalid format (not alphanumeric)', async () => {
      await expect(
        provider.redeemClaim(VALID_TOKEN, 'invalid-address'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for an address not starting with G', async () => {
      // Stellar secret keys start with 'S'; using one here should fail validation
      const secretKeyAddress =
        'SABCD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA';
      await expect(
        provider.redeemClaim(VALID_TOKEN, secretKeyAddress),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for an address shorter than 56 characters', async () => {
      await expect(provider.redeemClaim(VALID_TOKEN, 'GSHORT')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException for an address longer than 56 characters', async () => {
      // Extra characters appended to an otherwise valid address
      const tooLongAddress = VALID_DESTINATION + 'EXTRA';
      await expect(
        provider.redeemClaim(VALID_TOKEN, tooLongAddress),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('redeemClaim - sweep failure and rollback', () => {
    it('should rollback account status to PENDING_CLAIM when sweep fails', async () => {
      mockSweepsService.executeSweep.mockRejectedValue(
        new Error('Stellar network error'),
      );

      await expect(
        provider.redeemClaim(VALID_TOKEN, VALID_DESTINATION),
      ).rejects.toThrow();

      // After a failed sweep, the account must be reverted so the user can retry.
      // destinationAddress is reset to '' and claimedAt to null.
      expect(mockAccountsRepository.save).toHaveBeenLastCalledWith(
        expect.objectContaining({
          status: AccountStatus.PENDING_CLAIM,
          destinationAddress: '',
          claimedAt: null,
        }),
      );
    });

    it('should re-throw the original sweep error after rolling back account status', async () => {
      const sweepError = new Error('Stellar network error');
      mockSweepsService.executeSweep.mockRejectedValue(sweepError);

      // Ensures callers receive the actual failure reason rather than a wrapped error
      await expect(
        provider.redeemClaim(VALID_TOKEN, VALID_DESTINATION),
      ).rejects.toThrow('Stellar network error');
    });
  });
});
