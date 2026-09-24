import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  KMSClient,
  GenerateDataKeyCommand,
  DecryptCommand,
} from '@aws-sdk/client-kms';
import { SecretEncryptionUtil } from './secret-encryption.util.js';

/**
 * KmsKeyProvider
 *
 * Wraps SecretEncryptionUtil with AWS KMS envelope encryption.
 *
 * Key hierarchy:
 *   KMS CMK (Customer Master Key) — never leaves AWS
 *     └─ Data Key (AES-256) — generated per startup, stored encrypted
 *
 * On startup: calls GenerateDataKey to get a plaintext + encrypted data key.
 * The plaintext key is held in memory only; the encrypted blob is stored in
 * KMS_ENCRYPTED_DATA_KEY env var (or re-generated each restart).
 *
 * Environment variables:
 *   KMS_KEY_ID           - ARN or alias of the KMS CMK (required when KMS enabled)
 *   KMS_ENABLED          - set to 'false' to fall back to ENCRYPTION_KEY (default: true)
 *   AWS_REGION           - AWS region for KMS (default: us-east-1)
 */
@Injectable()
export class KmsKeyProvider implements OnModuleInit {
  private readonly logger = new Logger(KmsKeyProvider.name);
  private plaintextKey: string | null = null;
  private readonly kmsEnabled: boolean;
  private readonly kmsKeyId: string | undefined;
  private readonly fallbackKey: string;
  private readonly kmsClient: KMSClient;

  constructor(private readonly configService: ConfigService) {
    this.kmsEnabled = this.configService.getOrThrow<boolean>('app.kmsEnabled');
    this.kmsKeyId = this.configService.get<string>('app.kmsKeyId');
    this.fallbackKey = this.configService.getOrThrow<string>(
      'stellar.encryptionKey',
    );
    this.kmsClient = new KMSClient({
      region: this.configService.getOrThrow<string>('app.awsRegion'),
    });
  }

  async onModuleInit(): Promise<void> {
    if (!this.kmsEnabled || !this.kmsKeyId) {
      this.logger.warn(
        'KMS disabled or KMS_KEY_ID not set — using ENCRYPTION_KEY fallback',
      );
      return;
    }
    await this.loadDataKey();
  }

  /** Returns the active AES-256 key as a 64-char hex string. */
  getEncryptionKey(): string {
    return this.plaintextKey ?? this.fallbackKey;
  }

  encrypt(plaintext: string): string {
    return SecretEncryptionUtil.encrypt(plaintext, this.getEncryptionKey());
  }

  decrypt(encrypted: string): string {
    return SecretEncryptionUtil.decrypt(encrypted, this.getEncryptionKey());
  }

  private async loadDataKey(): Promise<void> {
    try {
      const cmd = new GenerateDataKeyCommand({
        KeyId: this.kmsKeyId,
        KeySpec: 'AES_256',
      });
      const response = await this.kmsClient.send(cmd);

      if (!response.Plaintext) {
        throw new Error('KMS GenerateDataKey returned no plaintext');
      }

      this.plaintextKey = Buffer.from(response.Plaintext).toString('hex');
      this.logger.log('KMS data key loaded successfully');
    } catch (err) {
      this.logger.error(
        `Failed to load KMS data key: ${(err as Error).message}. Falling back to ENCRYPTION_KEY`,
      );
    }
  }

  /** Re-wraps an existing encrypted data key blob from KMS. Used for key rotation. */
  async decryptDataKey(encryptedKey: Uint8Array): Promise<string> {
    const cmd = new DecryptCommand({
      KeyId: this.kmsKeyId,
      CiphertextBlob: encryptedKey,
    });
    const response = await this.kmsClient.send(cmd);
    if (!response.Plaintext) {
      throw new Error('KMS Decrypt returned no plaintext');
    }
    return Buffer.from(response.Plaintext).toString('hex');
  }
}
