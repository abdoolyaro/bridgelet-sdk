import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account } from './entities/account.entity.js';
import { CreateAccountDto } from './dto/create-account.dto.js';
import { AccountResponseDto } from './dto/account-response.dto.js';
import { StellarService } from '../stellar/stellar.service.js';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'crypto';
import { ConfigService } from '@nestjs/config';
import { AccountStatus } from './enums/account-status.enum.js';

/**
 * AccountsService — Service-Level Documentation & Contributor Guidance
 *
 * Lifecycle Overview
 * ------------------
 * This service is an orchestration layer in the Bridgelet flow responsible for
 * ephemeral account creation, funding, claim-token lifecycle management,
 * interaction with the `StellarService`, persistence of account state, and
 * shaping API responses (`AccountResponseDto`). Typical flow:
 *
 * 1. Ephemeral account creation: a keypair is generated and an account is
 *    provisioned/funded on the Stellar network via `StellarService`.
 * 2. Claim generation: a claim token is produced and a hash of that token is
 *    stored on the account record (the plain token is returned in the API
 *    response only). The token is used by end-users to claim the funded
 *    ephemeral account.
 * 3. Claiming: an external request exchanges the token for the secret.
 * 4. Post-claim: account status and destination fields are updated accordingly.
 *
 * Security Notes
 * --------------
 * - MVP placeholders: Several methods in this file include intentionally
 *   lightweight or placeholder implementations that are NOT production secure.
 *   These are clearly marked in the code. Examples include:
 *     - `encryptSecret()` currently uses base64 for storage (NOT SECURE).
 *     - Token signing uses the configured JWT secret; ensure the secret
 *       management and rotation policies meet your security requirements.
 *
 * - Token handling: the service stores only a SHA-256 hash of the claim token
 *   (`claimTokenHash`) rather than the raw token. The raw token is delivered
 *   once to callers via the generated claim URL. Changes to token format,
 *   signing algorithm, or expiry semantics are protocol-sensitive and will
 *   break clients if not coordinated.
 *
 * - Secret storage: `secretKeyEncrypted` is intended to hold an encrypted
 *   secret. Treat the current implementation as a placeholder. Do NOT
 *   replace it with a new encoding/encryption scheme without documenting the
 *   migration plan and ensuring compatibility for any live secrets.
 *
 * Integration Boundaries
 * ----------------------
 * - Assumptions about `StellarService`:
 *     - It provides `generateKeypair()` and `createEphemeralAccount()` with
 *       the semantics expected here (returning a transaction hash when
 *       funding succeeds).
 *     - The format of the public key and secret follow Stellar keypair
 *       conventions; these assumptions are protocol-sensitive.
 *
 * - External integrators rely on stable response fields (e.g., `claimUrl`,
 *   `publicKey`, `txHash`). Response shaping is backward-compatible by
 *   design — avoid renaming or removing fields without a migration/compat
 *   strategy.
 *
 * Mapping & DTO Intent
 * --------------------
 * - Response DTOs intentionally expose only a subset of stored fields. For
 *   example, the raw `secret` is never returned; the `claimUrl` provides a
 *   user-facing way to perform a claim without disclosing secrets.
 * - Conditional fields: some response fields are conditionally populated
 *   (e.g., `claimUrl` only when a claim token exists). Maintain these rules
 *   when changing mapping logic to avoid leaking internal state.
 *
 * Contributor Guidance — Ask If Unsure
 * -----------------------------------
 * ⚠️ This service encodes protocol-level behavior. If you are unsure whether
 * a change affects lifecycle guarantees, consult maintainers before modifying
 * logic.
 *
 * If any behavior is unclear:
 * - Check the repository README for architecture context.
 * - Review the `docs/` directory for protocol expectations.
 * - Ask before making assumptions, especially around: token generation,
 *   expiry semantics, data exposure, or secret handling.
 *
 * When in doubt: document, do not redesign silently.
 */
@Injectable()
export class AccountsService {
  private readonly logger = new Logger(AccountsService.name);
  private readonly ENCRYPTION_KEY: Buffer;
  private readonly IV_LENGTH = 16;
  
  constructor(
    @InjectRepository(Account)
    private accountsRepository: Repository<Account>,
    private configService: ConfigService,
    private jwtService: JwtService,
    private stellarService: StellarService,
  ) {
    this.ENCRYPTION_KEY = Buffer.from(
      this.configService.getOrThrow<string>('app.encryptionKey'),
      'hex',
    );
  }

  public async create(
    createAccountDto: CreateAccountDto,
  ): Promise<AccountResponseDto> {
    // Generate ephemeral keypair
    const ephemeralKeypair = this.stellarService.generateKeypair();

    // Calculate expiry timestamp
    const expiresAt = new Date(Date.now() + createAccountDto.expiresIn * 1000);

    // Generate claim token
    const claimToken = this.generateClaimToken(ephemeralKeypair.publicKey());

    // Hash claim token for storage
    const claimTokenHash = crypto
      .createHash('sha256')
      .update(claimToken)
      .digest('hex');

    // Save with INITIALIZING status first so we have a DB record for cleanup
    // if the Stellar/contract steps fail
    const account = this.accountsRepository.create({
      publicKey: ephemeralKeypair.publicKey(),
      secretKeyEncrypted: this.encryptSecret(ephemeralKeypair.secret()),
      fundingSource: createAccountDto.fundingSource,
      amount: createAccountDto.amount,
      asset: createAccountDto.asset,
      status: AccountStatus.INITIALIZING,
      claimTokenHash,
      expiresAt,
      metadata: createAccountDto.metadata,
    });

    await this.accountsRepository.save(account);

    try {
      const txHash = await this.stellarService.createEphemeralAccount({
        publicKey: ephemeralKeypair.publicKey(),
        amount: createAccountDto.amount,
        asset: createAccountDto.asset,
        expiresIn: createAccountDto.expiresIn,
        recoveryAddress: createAccountDto.fundingSource,
        contractId: this.configService.getOrThrow<string>(
          'stellar.ephemeralContractId',
        ),
      });

      // Both Horizon and contract succeeded — advance to real status
      account.status = AccountStatus.PENDING_PAYMENT;
      await this.accountsRepository.save(account);

      return {
        accountId: account.id,
        publicKey: account.publicKey,
        claimUrl: this.generateClaimUrl(claimToken),
        txHash,
        amount: account.amount,
        asset: account.asset,
        status: account.status,
        expiresAt: account.expiresAt,
        createdAt: account.createdAt,
      };
    } catch (error: unknown) {
      // Mark as FAILED so the record is traceable but clearly broken
      account.status = AccountStatus.FAILED;
      await this.accountsRepository.save(account);

      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Account creation failed for ${ephemeralKeypair.publicKey()}: ${message}`,
      );
      // preserve original error if it's an Error, otherwise wrap
      if (error instanceof Error) throw error;
      throw new Error(message);
    }
  }

  public async findOne(id: string): Promise<AccountResponseDto> {
    const account = await this.accountsRepository.findOne({ where: { id } });

    if (!account) {
      throw new NotFoundException(`Account ${id} not found`);
    }

    return this.mapToResponseDto(account);
  }

  public async findAll({
    status,
    limit,
    offset,
  }: {
    status?: AccountStatus;
    limit: number;
    offset: number;
  }): Promise<{ accounts: AccountResponseDto[]; total: number }> {
    const query = this.accountsRepository.createQueryBuilder('account');

    if (status) {
      query.where('account.status = :status', { status });
    }

    query.skip(offset).take(Math.min(limit, 100));

    const [accounts, total] = await query.getManyAndCount();

    return {
      accounts: accounts.map((acc) => this.mapToResponseDto(acc)),
      total,
    };
  }

  private generateClaimToken(publicKey: string): string {
    /**
     * generateClaimToken
     * ------------------
     * Purpose: Sign a short-lived JWT that encodes the public key and a
     * 'claim' type. The resulting token is handed to callers and is the
     * secret used to claim the ephemeral account.
     *
     * Security notes / contributor guidance:
     * - The token expiry (`app.claimTokenExpiry`) is protocol-sensitive.
     *   Changing expiry semantics requires coordination with clients.
     * - The JWT signing secret must be managed and rotated safely. Do not
     *   switch to a different signing mechanism without an explicit design
     *   and migration plan.
     */
    // const secret =
    //   this.configService.get<string>('app.jwtSecret') ?? 'fallback secret';
    const expiry =
      this.configService.get<number>('app.claimTokenExpiry') ?? 2592000;

    return this.jwtService.sign(
      { publicKey, type: 'claim' },
      { expiresIn: `${expiry}s` },
    );
  }

  private generateClaimUrl(token: string): string {
    // generateClaimUrl
    // ----------------
    // Purpose: Build the user-facing URL used to perform the claim flow.
    // Integration notes:
    // - `CLAIM_BASE_URL` is an environment-level integration point. External
    //   systems and email templates may rely on the shape of this URL.
    const baseUrl = process.env.CLAIM_BASE_URL || 'https://claim.bridgelet.io';
    return `${baseUrl}/c/${token}`;
  }

  private encryptSecret(secret: string): string {
    const iv = crypto.randomBytes(this.IV_LENGTH);
    const cipher = crypto.createCipheriv(
      'aes-256-gcm',
      this.ENCRYPTION_KEY,
      iv,
    );

    const encrypted = Buffer.concat([
      cipher.update(secret, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  /**
   * Decrypts a secret key encrypted by encryptSecret().
   * Required when the claims module needs to sign sweep transactions
   * using the ephemeral account's secret.
   */
  private decryptSecret(encrypted: string): string {
    const [ivHex, authTagHex, dataHex] = encrypted.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const data = Buffer.from(dataHex, 'hex');

    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      this.ENCRYPTION_KEY,
      iv,
    );
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(data), decipher.final()]).toString(
      'utf8',
    );
  }

  private mapToResponseDto(account: Account): AccountResponseDto {
    return {
      accountId: account.id,
      publicKey: account.publicKey,
      // Mapping note: we intentionally never return raw tokens here.
      // When a token exists, we return a placeholder claim URL in list/endpoints
      // that shouldn't leak the real token. The single-response `create`
      // operation returns the real `claimUrl` containing the token.
      claimUrl: account.claimTokenHash ? this.generateClaimUrl('***') : null,
      amount: account.amount,
      asset: account.asset,
      status: account.status,
      expiresAt: account.expiresAt,
      createdAt: account.createdAt,
      claimedAt: account.claimedAt,
      destination: account.destinationAddress,
      metadata: account.metadata,
    };
  }
}
