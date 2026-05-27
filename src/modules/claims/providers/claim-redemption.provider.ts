import {
  Injectable,
  BadRequestException,
  Logger,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { Claim } from '../entities/claim.entity.js';
import { Account } from '../../accounts/entities/account.entity.js';
import { ClaimRedemptionResponseDto } from '../dto/claim-redemption-response.dto.js';
import { SweepsService } from '../../sweeps/sweeps.service.js';
import { TokenVerificationProvider } from './token-verification.provider.js';
import { AccountStatus } from '../../accounts/enums/account-status.enum.js';

@Injectable()
export class ClaimRedemptionProvider {
  private readonly logger = new Logger(ClaimRedemptionProvider.name);

  constructor(
    @InjectRepository(Claim)
    private claimsRepository: Repository<Claim>,
    @InjectRepository(Account)
    private accountsRepository: Repository<Account>,
    private tokenVerificationProvider: TokenVerificationProvider,
    private sweepsService: SweepsService,
    // TEMPORARY: WebhooksService not yet implemented - commented out to allow dev server to start
    // private webhooksService: WebhooksService,
  ) {}

  async redeemClaim(
    token: string,
    destinationAddress: string,
  ): Promise<ClaimRedemptionResponseDto> {
    this.logger.log(`Redeeming claim for destination: ${destinationAddress}`);

    // Verify token first
    // In claim-redemption.provider.ts redeemClaim method:
    const tokenHash = this.hashToken(token);
    try {
      await this.tokenVerificationProvider.verifyClaimToken(token);
    } catch (error) {
      if (error instanceof ConflictException) {
        // Account already claimed - return existing claim
        const claimedAccount = await this.accountsRepository.findOne({
          where: { claimTokenHash: tokenHash },
        });
        if (claimedAccount) {
          const existingClaim = await this.claimsRepository.findOne({
            where: { accountId: claimedAccount.id },
          });
          if (existingClaim) {
            return {
              success: true,
              txHash: existingClaim.sweepTxHash,
              amountSwept: existingClaim.amountSwept,
              asset: existingClaim.asset,
              destination: existingClaim.destinationAddress,
              sweptAt: existingClaim.claimedAt,
              message: 'Claim was already redeemed',
            };
          }
        }
      }
      throw error;
    }

    // Validate destination address
    this.validateStellarAddress(destinationAddress);

    // Get account
    const account = await this.accountsRepository.findOne({
      where: { claimTokenHash: tokenHash },
    });

    if (!account) {
      throw new BadRequestException('Invalid or expired claim token');
    }

    // Double-check not already claimed (race condition protection)
    if (account.status === AccountStatus.CLAIMED) {
      this.logger.log(`Claim already redeemed for account: ${account.id}`);

      // Return existing claim details
      const existingClaim = await this.claimsRepository.findOne({
        where: { accountId: account.id },
      });

      if (!existingClaim) {
        throw new BadRequestException(
          'Claim record not found for already redeemed account',
        );
      }

      return {
        success: true,
        txHash: existingClaim.sweepTxHash,
        amountSwept: existingClaim.amountSwept,
        asset: existingClaim.asset,
        destination: existingClaim.destinationAddress,
        sweptAt: existingClaim.claimedAt,
        message: 'Claim was already redeemed',
      };
    }

    // Update account status to prevent concurrent claims
    account.status = AccountStatus.CLAIMED;
    account.destinationAddress = destinationAddress;
    account.claimedAt = new Date();
    await this.accountsRepository.save(account);

    try {
      // Execute sweep via SweepsService
      const sweepResult = await this.sweepsService.executeSweep({
        accountId: account.id,
        ephemeralPublicKey: account.publicKey,
        ephemeralSecret: this.decryptSecret(account.secretKeyEncrypted),
        destinationAddress,
        amount: account.amount,
        asset: account.asset,
      });

      // Create claim record
      const claim = this.claimsRepository.create({
        accountId: account.id,
        destinationAddress,
        sweepTxHash: sweepResult.txHash,
        amountSwept: account.amount,
        asset: account.asset,
        claimedAt: new Date(),
      });

      await this.claimsRepository.save(claim);

      this.logger.log(`Claim redeemed successfully: ${claim.id}`);

      // TEMPORARY: WebhooksService not yet implemented - webhook trigger commented out
      // await this.webhooksService.triggerEvent('sweep.completed', {
      //   accountId: account.id,
      //   amount: account.amount,
      //   asset: account.asset,
      //   destination: destinationAddress,
      //   txHash: sweepResult.txHash,
      //   sweptAt: claim.claimedAt,
      //   metadata: account.metadata,
      // });

      return {
        success: true,
        txHash: sweepResult.txHash,
        amountSwept: account.amount,
        asset: account.asset,
        destination: destinationAddress,
        sweptAt: claim.claimedAt,
      };
    } catch (error) {
      // Revert account status on failure
      account.status = AccountStatus.PENDING_CLAIM;
      account.destinationAddress = '';
      account.claimedAt = null;
      await this.accountsRepository.save(account);

      const typedError = error as Error;
      this.logger.error(
        `Claim redemption failed: ${typedError.message}`,
        typedError.stack,
      );

      // TEMPORARY: WebhooksService not yet implemented - webhook trigger commented out
      // await this.webhooksService.triggerEvent('sweep.failed', {
      //   accountId: account.id,
      //   amount: account.amount,
      //   asset: account.asset,
      //   destination: destinationAddress,
      //   error: error.message,
      //   timestamp: new Date(),
      // });

      throw error;
    }
  }

  private validateStellarAddress(address: string): void {
    // Stellar public keys start with 'G' and are 56 characters
    if (!address.startsWith('G') || address.length !== 56) {
      throw new BadRequestException('Invalid Stellar address format');
    }
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private decryptSecret(encrypted: string): string {
    // TODO: Implement proper decryption (AES-256)
    // For MVP, using base64 (NOT SECURE for production)
    return Buffer.from(encrypted, 'base64').toString('utf-8');
  }
}
