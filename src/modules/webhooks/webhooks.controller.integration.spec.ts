import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ThrottlerGuard } from '@nestjs/throttler';
import { randomUUID } from 'crypto';
import { WebhooksController } from './webhooks.controller.js';
import { WebhooksService } from './webhooks.service.js';
import { Webhook } from './entities/webhook.entity.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';

// In-memory fake repository (not a jest.fn() mock) backing real service logic.
class InMemoryWebhookRepository {
  private rows = new Map<string, Webhook>();
  create(data: Partial<Webhook>) {
    return { id: randomUUID(), createdAt: new Date(), ...data } as Webhook;
  }
  save(w: Webhook) {
    this.rows.set(w.id, w);
    return Promise.resolve(w);
  }
  findOne({ where: { id } }: { where: { id: string } }) {
    return Promise.resolve(this.rows.get(id) ?? null);
  }
  createQueryBuilder() {
    const active = () => [...this.rows.values()].filter((w) => w.isActive);
    const page = {
      getManyAndCount: () => Promise.resolve([active(), active().length]),
    };
    return { where: () => ({ skip: () => ({ take: () => page }) }) };
  }
}

describe('WebhooksController integration (real service + repo)', () => {
  let controller: WebhooksController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WebhooksController],
      providers: [
        WebhooksService,
        {
          provide: getRepositoryToken(Webhook),
          useClass: InMemoryWebhookRepository,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get(WebhooksController);
  });

  it('supports create -> list -> update -> delete', async () => {
    const created = await controller.create({
      url: 'https://api.example.com/hooks',
      events: ['account.created'],
    });
    const ids = async () =>
      (await controller.findAll()).webhooks.map((w) => w.id);

    expect(await ids()).toContain(created.id);

    const updated = await controller.update(created.id, { description: 'x' });
    expect(updated.description).toBe('x');

    await controller.remove(created.id);
    expect(await ids()).not.toContain(created.id);
  });
});
