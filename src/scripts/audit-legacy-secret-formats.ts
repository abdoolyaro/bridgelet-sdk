import {
  SecretEncryptionUtil,
  SecretFormat,
} from '../common/crypto/secret-encryption.util.js';

/**
 * auditLegacySecretFormats
 *
 * Scans `accounts.secretKeyEncrypted` values and reports how many are still
 * in a legacy format, so operators know when the legacy-format branches in
 * SecretEncryptionUtil.decrypt() can finally be deleted (see issue #621).
 * Run ad hoc against a DataSource query, e.g.:
 *   const rows = await dataSource.query('SELECT "secretKeyEncrypted" FROM accounts');
 *   console.log(auditLegacySecretFormats(rows.map((r) => r.secretKeyEncrypted)));
 */
export interface LegacyFormatAuditResult {
  total: number;
  byFormat: Record<SecretFormat, number>;
  legacyCount: number;
}

export function auditLegacySecretFormats(
  encryptedValues: string[],
): LegacyFormatAuditResult {
  const byFormat: Record<SecretFormat, number> = {
    'prefixed-aes-v1': 0,
    'unprefixed-aes': 0,
    'legacy-base64': 0,
    corrupt: 0,
  };
  for (const value of encryptedValues) {
    byFormat[SecretEncryptionUtil.classify(value)]++;
  }
  const legacyCount = byFormat['unprefixed-aes'] + byFormat['legacy-base64'];
  return { total: encryptedValues.length, byFormat, legacyCount };
}
