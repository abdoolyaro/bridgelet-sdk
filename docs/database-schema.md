# Database Schema

The current schema is created entirely through the migrations in `src/database/migrations/`.

## Tables

- `accounts`: stores ephemeral account lifecycle data, including encrypted secret material, funding metadata, expiry timestamps, and optional claim metadata.
- `claims`: stores completed claim records and references `accounts.id` through a cascading foreign key on `accountId`.
- `webhooks`: stores outbound webhook subscriptions.
- `webhook_deliveries`: stores per-delivery webhook attempts, including the subscribed webhook reference (`subscription_id`), event type, payload hash, retry count, last response details, delivery timestamp, and creation timestamp. It references `webhooks.id` with `ON DELETE CASCADE` and has a composite index on (`subscription_id`, `created_at`).
- `contract_events`: stores indexed Soroban contract events, including event type, contract address, ledger sequence, transaction hash, event payload, and creation timestamp.

## Account Status Enum

`account_status_enum` currently contains these values, in order:

`initializing`, `pending_payment`, `pending_claim`, `claiming`, `claimed`, `expired`, `failed`

## Connection Pool Configuration

TypeORM is configured with the following pool settings in both
`src/config/database.config.ts` (NestJS runtime) and
`src/config/typeorm.config.ts` (migration CLI):

| Setting                | Value | Rationale                                                                                                                                                    |
| ---------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `min`                  | 2     | Keeps two warm connections alive to avoid TCP + TLS + PostgreSQL auth latency on the first request after an idle period.                                     |
| `max`                  | 10    | Caps per-instance connections to leave room for other services sharing the PostgreSQL server. Aligns with a conservative PgBouncer transaction-mode default. |
| `acquireTimeoutMillis` | 3000  | Fail-fast: surface an error after 3 s if no connection becomes available rather than queuing silently, which would mask connection leaks.                    |

Settings are passed to the underlying `pg` Pool constructor via the TypeORM `extra` key.

## Pool Health Check

`GET /health` performs a live pool probe: it races a `SELECT 1` against the
`acquireTimeoutMillis` (3 000 ms) timeout and reports one of three states:

| `services.database.healthy` | `services.database.poolExhausted` | Meaning                                                         |
| --------------------------- | --------------------------------- | --------------------------------------------------------------- |
| `true`                      | `false`                           | Normal operation                                                |
| `false`                     | `true`                            | All pool connections are in use — scale up or investigate leaks |
| `false`                     | `false`                           | Database unreachable (network, credentials, etc.)               |

## Database Indexes

### accounts

| Index name                      | Columns               | Query served                                                                                                                      |
| ------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `IDX_accounts_publicKey`        | `publicKey`           | Account lookup by Stellar public key                                                                                              |
| contractId                      | varchar(56), nullable | Stellar contract ID of the ephemeral account, set once Horizon + contract creation succeed (`stellar.contracts.ephemeralAccount`) |
| `IDX_accounts_status`           | `status`              | Status-filtered API list (`GET /accounts?status=…`)                                                                               |
| `IDX_accounts_claimTokenHash`   | `claimTokenHash`      | Token redemption lookup                                                                                                           |
| `IDX_accounts_expiresAt`        | `expiresAt`           | Range scans on expiry timestamp                                                                                                   |
| `IDX_accounts_status_expiresAt` | `status`, `expiresAt` | Expiry scheduler: `WHERE status IN (…) AND expiresAt < NOW()` — composite eliminates the bitmap AND step                          |
| `IDX_accounts_status_createdAt` | `status`, `createdAt` | INITIALIZING cleanup: `WHERE status = 'initializing' AND createdAt < <cutoff>`                                                    |
| `IDX_accounts_createdAt`        | `createdAt`           | Audit / time-boxed reporting range scans                                                                                          |

### claims

| Index name             | Columns     | Query served                              |
| ---------------------- | ----------- | ----------------------------------------- |
| `IDX_claims_accountId` | `accountId` | FK lookup when joining claims to accounts |

### webhooks

| Index name              | Columns    | Query served                        |
| ----------------------- | ---------- | ----------------------------------- |
| `IDX_webhooks_isActive` | `isActive` | Filter active webhook subscriptions |

### Index design notes (EXPLAIN ANALYZE audit)

- The **composite indexes on `accounts`** use `status` as the leading column because it is a low-cardinality enum (7 values) that prunes the candidate set effectively before the timestamp column filters further. PostgreSQL can also use `IDX_accounts_status_expiresAt` and `IDX_accounts_status_createdAt` as left-prefix scans for status-only queries.
- `IDX_accounts_status` (single-column) is retained alongside the composites to support `EXPLAIN ANALYZE`-verified single-predicate queries.
- All indexes use the default B-tree access method, which supports equality, range (`<`, `>`), and `ORDER BY` optimisations.

## Migration Verification

`src/database/migrations.integration.spec.ts` provisions a fresh embedded PostgreSQL database, applies every migration, verifies:

1. The resulting schema matches TypeORM entity metadata (`schemaInSync: true`).
2. The `claims.accountId` and `webhook_deliveries.subscription_id` foreign keys are enforced (inserts with orphan UUIDs are rejected).
3. The three high-traffic composite/standalone indexes exist after migration `1718100006000`.
4. The `contract_events` table exists with the expected columns and accepts inserts after migration `1718100007000`.

## Foreign Key Cascade Behavior

`claims.accountId` references `accounts.id` with `onDelete: 'CASCADE'`
(`FK_claims_accountId`, set in `1718100001000-CreateClaimsTable` and mirrored
in `src/modules/claims/entities/claim.entity.ts`). This is intentional and
does **not** interact with `accounts` soft-delete: `deletedAt` only sets a
flag and never removes the `accounts` row, so soft-deleting an account never
triggers this FK and existing claims remain intact and queryable. `CASCADE`
only fires on an actual (hard) `DELETE` of an `accounts` row, at which point
its claim records are removed with it rather than being orphaned.
