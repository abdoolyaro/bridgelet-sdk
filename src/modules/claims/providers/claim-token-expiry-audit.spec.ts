import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { TokenVerificationProvider } from './token-verification.provider.js';
import { Account } from '../../accounts/entities/account.entity.js';
import { AccountStatus } from '../../accounts/enums/account-status.enum.js';

jest.mock('jsonwebtoken', () => ({
  ...jest.requireActual('jsonwebtoken'),
  verify: jest.fn(),
}));

// Audit for issue: "CLAIM_TOKEN_EXPIRY default of 30 days vs ephemeral-account
// expiry". Conclusion: the two are already independent by design —
// TokenVerificationProvider.verifyClaimToken() checks `account.expiresAt`
// explicitly and does NOT trust the JWT's own (longer-lived) `exp` claim as
// proof the underlying account is still claimable. This test pins that down
// so it can't regress silently.
describe('Claim token expiry vs. account expiry (audit)', () => {
  let provider: TokenVerificationProvider;
  const mockAccountRepository = { findOne: jest.fn() };
  const mockConfigService = { getOrThrow: jest.fn().mockReturnValue('secret') };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TokenVerificationProvider,
        {
          provide: getRepositoryToken(Account),
          useValue: mockAccountRepository,
        },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();
    provider = module.get(TokenVerificationProvider);
    jest.clearAllMocks();
    mockConfigService.getOrThrow.mockReturnValue('secret');
  });

  it('rejects a JWT that has not yet hit its own exp once the account has already expired', async () => {
    // exp is 29 days out (well within the 30-day CLAIM_TOKEN_EXPIRY default),
    // so jwt.verify() would happily accept it on its own.
    (jwt.verify as jest.Mock).mockReturnValue({
      publicKey: 'GTEST...',
      type: 'claim',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 29 * 86400,
    });
    mockAccountRepository.findOne.mockResolvedValue({
      id: 'acct-1',
      status: AccountStatus.PENDING_CLAIM,
      expiresAt: new Date(Date.now() - 1000), // account itself expired 1s ago
    });

    await expect(provider.verifyClaimToken('t')).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
