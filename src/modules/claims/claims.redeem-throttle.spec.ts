import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { ClaimsController } from './claims.controller.js';
import { ClaimsService } from './claims.service.js';

// Claim tokens are bearer secrets guarding on-chain fund movement, so
// /claims/redeem carries its own tighter @Throttle limit (see
// claims.controller.ts) instead of relying solely on the app-wide default
// in app.module.ts. This exercises the REAL ThrottlerGuard (not overridden)
// to confirm repeated redemption attempts actually get throttled.
describe('POST /claims/redeem throttling', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60000, limit: 5 }])],
      controllers: [ClaimsController],
      providers: [
        {
          provide: ClaimsService,
          useValue: {
            redeemClaim: jest
              .fn()
              .mockRejectedValue(new Error('invalid token')),
          },
        },
      ],
    }).compile();

    app = module.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 429 after exceeding the redeem-specific limit', async () => {
    const body = { claimToken: 'bad-token', destinationAddress: 'addr' };
    let lastStatus = 0;
    for (let i = 0; i < 6; i++) {
      const res = await request(app.getHttpServer())
        .post('/claims/redeem')
        .send(body);
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });
});
