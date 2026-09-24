# Webhook Payload Verification

Companion to `docs/webhook-events.md`. Every outbound delivery is signed with
HMAC-SHA256 over the raw JSON body, using the webhook's `secret`
(`WebhooksService.computeSignature`), and sent as:

```
X-Bridgelet-Signature: sha256=<hex-digest>
```

## Verifying a payload (Node.js)

```js
const crypto = require('crypto');

function isValidSignature(rawBody, header, secret) {
  const expected = `sha256=${crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex')}`;
  return crypto.timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}
```

Always verify against the raw request body (before JSON parsing) — a
re-serialized body will not match the signature.

## Example payload

```json
{
  "event": "sweep.partial",
  "accountId": "acc_9f2c...",
  "status": "partial_sweep",
  "timestamp": "2026-09-24T10:00:00.000Z"
}
```

Fields are stable per `event` type; new optional fields may be added without
notice, but no field is ever removed or renamed within a major API version —
integrators should ignore unrecognized fields rather than reject them.
