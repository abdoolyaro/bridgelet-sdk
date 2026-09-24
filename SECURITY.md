# Security

This document describes how Bridgelet SDK protects sensitive data at rest, in particular the ephemeral Stellar secret keys the service is responsible for custodying between account creation and claim redemption.

## Ephemeral secret key encryption

Every ephemeral account's Stellar secret key is encrypted before it is written to `accounts.secretKeyEncrypted` and is only ever decrypted in-memory, for the duration of a claim redemption, immediately before it is handed to the signing/sweep path.

- **Algorithm:** AES-256-GCM (authenticated encryption — tamper-evident, unique IV per write).
- **Implementation:** [`SecretEncryptionUtil`](src/common/crypto/secret-encryption.util.ts). This is the single, shared implementation for encrypt/decrypt of secret material — it must never be reimplemented inline elsewhere.
- **Stored format:** `aes256gcm:v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>`. The `aes256gcm:v1:` prefix makes the format self-describing so a future format change (`v2`, KMS envelope metadata, etc.) fails loudly on an unrecognized version rather than silently mis-decoding.
- **Key length:** 256-bit (32-byte) key, supplied as a 64-character hex string.

### Key management

The encryption key is never stored alongside the encrypted data (i.e. never in the database, never committed to the repo).

- **Production (recommended):** [`KmsKeyProvider`](src/common/crypto/kms-key.provider.ts) sources the data-encryption key from AWS KMS via envelope encryption:
  - On startup, the service calls `GenerateDataKey` against a KMS Customer Master Key (`KMS_KEY_ID`). The plaintext data key is held in memory only, for the lifetime of the process, and is used to encrypt/decrypt secret rows via `SecretEncryptionUtil`. The CMK itself never leaves AWS.
  - Configure with `KMS_ENABLED=true`, `KMS_KEY_ID=<arn-or-alias>`, `AWS_REGION=<region>`.
  - Key rotation is a distinct operational concern from this envelope scheme — rotating the CMK requires re-wrapping (`decryptDataKey`) and re-encrypting existing rows; it is not automatic.
- **Fallback (non-production / local dev only):** if `KMS_ENABLED=false` or `KMS_KEY_ID` is unset, the service falls back to a static key from the `ENCRYPTION_KEY` environment variable (see `.env.example`). This path exists for local development and tests. **Do not run production with real funds on the `ENCRYPTION_KEY` fallback path** — use KMS.

### Migration from legacy formats

Prior to PR #193, this service persisted secret keys with `Buffer.from(secret).toString('base64')` — encoding, not encryption. That placeholder is no longer produced by any code path, but rows written before the fix may still hold a base64 value in non-production databases.

`SecretEncryptionUtil.decrypt()` refuses to decode a base64 row (it throws a descriptive error pointing at the migration tool) rather than silently treating it as ciphertext. To reclassify and re-encrypt any legacy rows (base64 placeholder, or unprefixed pre-`v1` AES-GCM), run:

```bash
# Dry run (default) — reports what would change, writes nothing
npm run migrate:secrets

# Actual migration — requires both flags
npm run migrate:secrets -- --i-have-a-backup --execute
```

See the header comment in [`src/scripts/migrate-secrets.ts`](src/scripts/migrate-secrets.ts) for full safety semantics (dry-run default, optimistic concurrency, audit log, halt-on-corrupt-row).

**No production deployment with real funds should occur against a database that still has any `legacy-base64` rows.** Run the migration (or start from a fresh database) first.

### Test coverage

- [`src/common/crypto/encryption.util.spec.ts`](src/common/crypto/encryption.util.spec.ts) covers: round-trip correctness, unique ciphertext per call (random IV), rejection of a tampered ciphertext, rejection of the wrong key, descriptive rejection errors for legacy base64 and unsupported format versions, and the `classify()` helper used by the migration script.
- [`src/common/crypto/kms-key.provider.spec.ts`](src/common/crypto/kms-key.provider.spec.ts) covers the KMS/fallback key-selection logic.
- [`src/scripts/migration-cli.spec.ts`](src/scripts/migration-cli.spec.ts) covers the migration CLI's flag parsing and audit logging.

## Claim tokens

Claim tokens are signed JWTs (`app.jwtSecret`). Only a SHA-256 hash of the token (`claimTokenHash`) is persisted; the raw token is returned to the caller exactly once, in the `create` response's `claimUrl`.

## Reporting a vulnerability

If you discover a security issue in this repository, please do not open a public GitHub issue. Contact the maintainers directly so the issue can be triaged and fixed before disclosure.
