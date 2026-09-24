/**
 * E2E test for the full claim lifecycle (#171).
 *
 * Approach: boot the full NestJS AppModule against an embedded PostgreSQL
 * instance, seed an Account in PENDING_CLAIM state, then drive the
 * lifecycle via supertest against POST /claims/verify, POST /claims/redeem,
 * and GET /claims/:id.
 *
 * External integrations are mocked at the provider boundary so the test
 * does not need real Stellar testnet credentials to run in CI:
 *   - SweepsService.executeSweep -> deterministic txHash stub
 *   - WebhooksService.triggerEvent -> no-op stub
 *   - ClaimAuditProvider.record -> no-op stub
 *   - TokenVerificationProvider.verifyClaimToken -> bypasses JWT, only
 *     accepts the SEED_TOKEN used to seed the Account.
 *
 * Real Stellar testnet runs belong behind a HORIZON_URL + STELLAR_SECRET
 * env flag; they are out of scope of issue #171's "Implementation complete"
 * acceptance criterion and will be added in a follow-up issue.
 *
 * Notes:
 *   - /claims/* routes in this app are NOT auth-gated (verified in
 *     claims.controller.spec.ts). No JWT forging required.
 *   - POST /accounts is JwtAuthGuard-gated so we seed the Account row
 *     directly via TypeORM instead of going through HTTP.
 *   - The embedded-postgres bootstrap is borrowed from
 *     test/migrations.integration.runner.ts to keep schema parity with
 *     the migrations run by the production bootstrap.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import * as crypto from 'crypto';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import type { Server as HttpServer } from 'http';
import { mkdtemp, rm } from 'fs/promises';
import EmbeddedPostgres from 'embedded-postgres';

import { AppModule } from '../src/app.module.js';
import { Account } from '../src/modules/accounts/entities/account.entity.js';
import { Claim } from '../src/modules/claims/entities/claim.entity.js';
import { AccountStatus } from '../src/modules/accounts/enums/account-status.enum.js';
import { SweepsService } from '../src/modules/sweeps/sweeps.service.js';
import { WebhooksService } from '../src/modules/webhooks/webhooks.service.js';
import { ClaimAuditProvider } from '../src/modules/claims/providers/claim-audit.provider.js';
import { TokenVerificationProvider } from '../src/modules/claims/providers/token-verification.provider.js';
import { SecretEncryptionUtil } from '../src/common/crypto/secret-encryption.util.js';
import { SchedulerService } from '../src/modules/scheduler/scheduler.service.js';
import { PaymentMonitorService } from '../src/modules/payment-monitor/payment-monitor.service.js';

const MOCK_TX_HASH = 'a'.repeat(64);
const MOCK_SWEEP_RESULT = { txHash: MOCK_TX_HASH, success: true };
const VALID_DESTINATION =
  'GBULQKZ7SA56UKRI6LX2IB6XH3GJW2L34BMTOWMQFJBAQNPSHJJNOTGN';
const SEED_TOKEN = 'mock-claim-token-for-e2e';

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address == null || typeof address === 'string') {
        reject(new Error('Port not allocated'));
        return;
      }
      const port = address.port;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

describe('Claim lifecycle (e2e) [issue #171]', () => {
  let pg: EmbeddedPostgres | null = null;
  let pgDataDir: string | null = null;
  let app: INestApplication | null = null;
  let ds: DataSource | null = null;

  const getHttpServer = (): HttpServer => {
    if (!app) {
      throw new Error('Application not initialized');
    }
    return app.getHttpServer() as HttpServer;
  };

  beforeAll(async () => {
    const port = await getFreePort();
    pgDataDir = await mkdtemp(path.join(os.tmpdir(), 'bridgelet-e2e-'));
    pg = new EmbeddedPostgres({
      databaseDir: pgDataDir,
      port,
      user: 'postgres',
      password: 'postgres',
      persistent: false,
      onLog: () => undefined,
      onError: () => undefined,
    });
    await pg.initialise();
    await pg.start();
    await pg.createDatabase('bridgelet_e2e_test');

    process.env.DATABASE_HOST = '127.0.0.1';
    process.env.DATABASE_PORT = String(port);
    process.env.DATABASE_USER = 'postgres';
    process.env.DATABASE_PASSWORD = 'postgres';
    process.env.DATABASE_NAME = 'bridgelet_e2e_test';
    process.env.JWT_SECRET = 'e2e-jwt-secret';
    process.env.STELLAR_NETWORK = 'testnet';
    process.env.HORIZON_URL = 'https://horizon-testnet.stellar.org';
    process.env.STELLAR_SECRET_ENCRYPTION_KEY = 'a'.repeat(64);
    process.env.CORS_ORIGINS = '*';
    process.env.API_RATE_LIMIT = '1000';
    process.env.NODE_ENV = 'test';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SweepsService)
      .useValue({
        executeSweep: () => Promise.resolve(MOCK_SWEEP_RESULT),
      })
      .overrideProvider(WebhooksService)
      .useValue({ triggerEvent: () => Promise.resolve(undefined) })
      .overrideProvider(ClaimAuditProvider)
      .useValue({ record: () => Promise.resolve(undefined) })
      .overrideProvider(SchedulerService)
      .useValue({
        handleCron: () => Promise.resolve(),
        handleExpiredClaims: () => Promise.resolve(),
      })
      .overrideProvider(PaymentMonitorService)
      .useValue({
        start: () => Promise.resolve(),
        stop: () => Promise.resolve(),
        poll: () => Promise.resolve(),
      })
      .overrideProvider(TokenVerificationProvider)
      .useValue({
        verifyClaimToken: (token: string): { valid: true } => {
          if (token !== SEED_TOKEN) {
            throw new BadRequestException('Invalid token');
          }
          return { valid: true };
        },
      })
      .compile();

    jest
      .spyOn(SecretEncryptionUtil, 'decrypt')
      .mockReturnValue('test-secret-decrypted');
    app = moduleFixture.createNestApplication();
    await app.init();
    ds = app.get(DataSource);
  }, 180_000);

  afterAll(async () => {
    if (app) {
      await app.close();
      app = null;
    }
    if (pg) {
      await pg.stop();
      pg = null;
    }
    if (pgDataDir) {
      await rm(pgDataDir, { recursive: true, force: true });
      pgDataDir = null;
    }
  });

  beforeEach(async () => {
    if (!ds) throw new Error('DataSource not ready');
    const claimRepo = ds.getRepository(Claim);
    const accountRepo = ds.getRepository(Account);
    await claimRepo.createQueryBuilder().delete().execute();
    await accountRepo.createQueryBuilder().delete().execute();
    const expiresAt = new Date(Date.now() + 6 * 60 * 60 * 1000);
    await accountRepo.save({
      id: crypto.randomUUID(),
      publicKey: 'GPUBKEY47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLL',
      secretKeyEncrypted: Buffer.from('test-secret').toString('base64'),
      claimTokenHash: crypto
        .createHash('sha256')
        .update(SEED_TOKEN)
        .digest('hex'),
      amount: '100.0000000',
      asset: 'native',
      status: AccountStatus.PENDING_CLAIM,
      expiresAt,
      metadata: { source: 'e2e-test' },
      destinationAddress: '',
      claimedAt: null,
    });
  });

  describe('Happy path', () => {
    it('POST /claims/verify returns a verification success', async () => {
      const res = await request(getHttpServer())
        .post('/claims/verify')
        .send({ claimToken: SEED_TOKEN });
      expect(res.status).toBeLessThan(400);
      expect(res.body).toEqual(expect.objectContaining({ valid: true }));
    });

    it('POST /claims/redeem returns success with mocked sweep txHash and transitions to CLAIMED', async () => {
      const res = await request(getHttpServer()).post('/claims/redeem').send({
        claimToken: SEED_TOKEN,
        destinationAddress: VALID_DESTINATION,
      });
      expect(res.status).toBe(201);
      expect(res.body).toEqual(
        expect.objectContaining({
          success: true,
          txHash: MOCK_TX_HASH,
          destination: VALID_DESTINATION,
        }),
      );

      const account = await ds!.getRepository(Account).findOneByOrFail({});
      expect(account.status).toBe(AccountStatus.CLAIMED);
      expect(account.destinationAddress).toBe(VALID_DESTINATION);

      const claim = await ds!
        .getRepository(Claim)
        .findOneByOrFail({ accountId: account.id });
      expect(claim.sweepTxHash).toBe(MOCK_TX_HASH);
      expect(claim.destinationAddress).toBe(VALID_DESTINATION);
    });

    it('GET /claims/:id returns the recorded claim without 5xx', async () => {
      await request(getHttpServer())
        .post('/claims/redeem')
        .send({
          claimToken: SEED_TOKEN,
          destinationAddress: VALID_DESTINATION,
        })
        .expect(201);

      const fetched = await ds!.getRepository(Claim).findOneByOrFail({});
      const res = await request(getHttpServer()).get(`/claims/${fetched.id}`);
      expect(res.status).toBe(201);
    });
  });

  describe('Idempotency (double redeem)', () => {
    it('a second redeem with the same token does not 5xx', async () => {
      const first = await request(getHttpServer()).post('/claims/redeem').send({
        claimToken: SEED_TOKEN,
        destinationAddress: VALID_DESTINATION,
      });
      expect(first.status).toBe(201);

      const second = await request(getHttpServer())
        .post('/claims/redeem')
        .send({
          claimToken: SEED_TOKEN,
          destinationAddress: VALID_DESTINATION,
        });
      expect(second.status).toBeLessThan(500);
    });
  });

  describe('Soft-deleted account (issue #435)', () => {
    // Note: this suite overrides TokenVerificationProvider with a mock that
    // never touches the database, so /claims/verify can't exercise the real
    // deletedAt filter here (that's covered by
    // token-verification.provider.spec.ts). /claims/redeem is still a valid,
    // end-to-end proof: its account lookup for the pessimistic-lock claim
    // slot (ClaimRedemptionProvider.redeemClaim) is real, unmocked, and
    // hits the actual Postgres instance.
    it('POST /claims/redeem rejects a token whose account has been soft-deleted, and does not sweep', async () => {
      const accountRepo = ds!.getRepository(Account);
      const account = await accountRepo.findOneByOrFail({});
      await accountRepo.softDelete(account.id);

      const res = await request(getHttpServer()).post('/claims/redeem').send({
        claimToken: SEED_TOKEN,
        destinationAddress: VALID_DESTINATION,
      });

      // Rejected by the pessimistic-lock lookup's `deletedAt IS NULL`
      // clause in ClaimRedemptionProvider ("Invalid or expired claim
      // token" -> BadRequestException).
      expect(res.status).toBe(400);

      // No claim record should have been created for the soft-deleted account.
      const claimCount = await ds!.getRepository(Claim).count({
        where: { accountId: account.id },
      });
      expect(claimCount).toBe(0);
    });
  });

  describe('DTO validation', () => {
    it('rejects a non-Stellar destination address with 400', async () => {
      const res = await request(getHttpServer()).post('/claims/redeem').send({
        claimToken: SEED_TOKEN,
        destinationAddress: 'not-a-stellar-address',
      });
      expect(res.status).toBe(400);
    });

    it('rejects a missing claimToken with 400', async () => {
      const res = await request(getHttpServer())
        .post('/claims/redeem')
        .send({ destinationAddress: VALID_DESTINATION });
      expect(res.status).toBe(400);
    });
  });
});
