import { SecretEncryptionUtil } from './secret-encryption.util.js';

/**
 * SecretRotationUtil
 *
 * Dual-key decrypt path on top of SecretEncryptionUtil so ciphertext written
 * under a previous ENCRYPTION_KEY / KMS data key still decrypts during a
 * rotation window (see issue #620). Tries the current key first, then falls
 * back to the previous key.
 */
export class SecretRotationUtil {
  static decryptWithRotation(
    encryptedString: string,
    currentKey: string,
    previousKey?: string,
  ): string {
    try {
      return SecretEncryptionUtil.decrypt(encryptedString, currentKey);
    } catch (currentErr) {
      if (!previousKey) throw currentErr;
      try {
        return SecretEncryptionUtil.decrypt(encryptedString, previousKey);
      } catch {
        throw currentErr;
      }
    }
  }

  static reencrypt(
    encryptedString: string,
    previousKey: string,
    newKey: string,
  ): string {
    const plaintext = SecretEncryptionUtil.decrypt(
      encryptedString,
      previousKey,
    );
    return SecretEncryptionUtil.encrypt(plaintext, newKey);
  }
}
