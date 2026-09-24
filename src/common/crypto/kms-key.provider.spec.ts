import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { KmsKeyProvider } from './kms-key.provider.js';
import { SecretEncryptionUtil } from './secret-encryption.util.js';

const FALLBACK_KEY = 'a'.repeat(64);

const mockConfigService = {
  getOrThrow: jest.fn().mockReturnValue(FALLBACK_KEY),
  get: jest.fn().mockReturnValue(undefined),
};

// Mock the KMS client send at module level
jest.mock('@aws-sdk/client-kms', () => ({
  KMSClient: jest.fn().mockImplementation(() => ({ send: jest.fn() })),
  GenerateDataKeyCommand: jest.fn().mockImplementation((input) => input),
  DecryptCommand: jest.fn().mockImplementation((input) => input),
}));

async function buildProvider(env: Record<string, string | undefined> = {}) {
  const saved = { ...process.env };
  Object.assign(process.env, env);

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      KmsKeyProvider,
      { provide: ConfigService, useValue: mockConfigService },
    ],
  }).compile();

  const provider = module.get<KmsKeyProvider>(KmsKeyProvider);
  // restore env
  for (const k of Object.keys(env)) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  return provider;
}

describe('KmsKeyProvider', () => {
  afterEach(() => jest.clearAllMocks());

  describe('when KMS is disabled', () => {
    it('returns the fallback ENCRYPTION_KEY', async () => {
      const provider = await buildProvider({ KMS_ENABLED: 'false' });
      await provider.onModuleInit();
      expect(provider.getEncryptionKey()).toBe(FALLBACK_KEY);
    });
  });

  describe('when KMS_KEY_ID is not set', () => {
    it('returns the fallback ENCRYPTION_KEY', async () => {
      const provider = await buildProvider({
        KMS_ENABLED: 'true',
        KMS_KEY_ID: undefined,
      });
      await provider.onModuleInit();
      expect(provider.getEncryptionKey()).toBe(FALLBACK_KEY);
    });
  });

  describe('encrypt / decrypt', () => {
    it('delegates to SecretEncryptionUtil with the active key', async () => {
      const provider = await buildProvider({ KMS_ENABLED: 'false' });
      const encSpy = jest
        .spyOn(SecretEncryptionUtil, 'encrypt')
        .mockReturnValue('encrypted');
      const decSpy = jest
        .spyOn(SecretEncryptionUtil, 'decrypt')
        .mockReturnValue('plaintext');

      expect(provider.encrypt('secret')).toBe('encrypted');
      expect(encSpy).toHaveBeenCalledWith('secret', FALLBACK_KEY);

      expect(provider.decrypt('encrypted')).toBe('plaintext');
      expect(decSpy).toHaveBeenCalledWith('encrypted', FALLBACK_KEY);
    });
  });
});
