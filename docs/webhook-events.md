# Webhook Events

## Delivery Signing

Every outbound webhook delivery is signed with HMAC-SHA256, computed over
the raw JSON request body using the webhook's `secret` (set at creation via
`CreateWebhookDto.secret`, or rotated later via `UpdateWebhookDto.secret`).

The signature is sent in the `X-Bridgelet-Signature` header as:

```
X-Bridgelet-Signature: sha256=<hex-encoded HMAC-SHA256 digest>
```

The event type is also sent separately in `X-Bridgelet-Event`.

To verify a delivery, recompute the HMAC-SHA256 digest of the exact raw
request body using your webhook's secret and compare it (constant-time) to
the value after `sha256=` in `X-Bridgelet-Signature`. If no secret was set
for the webhook, deliveries are still sent but signed with an empty key —
treat those as unverifiable and prefer always setting a secret.

If a webhook has no secret configured, `X-Bridgelet-Signature` is still
present but cannot be used to authenticate the sender.

## Delivery Records

Each delivery attempt is recorded in the `webhook_deliveries` table
(`WebhookDelivery` entity, `src/modules/webhooks/entities/webhook-delivery.entity.ts`):

- `eventType` — the event that triggered delivery
- `attemptCount` — number of delivery attempts made
- `lastResponseCode` / `lastResponseBody` — the receiving endpoint's last response
- `deliveredAt` — timestamp of the last successful delivery, if any
