# API Reference

## Accounts

### `CreateAccountDto.expiresIn`

`expiresIn` (seconds, integer) is the client-supplied lifetime of the
ephemeral account. Internally it is converted to `expiry_ledger`, the u32
ledger sequence the `bridgelet-core` contract expects:

```
expiry_ledger = current_ledger + (expiresIn / 5)
```

**Assumption:** Stellar ledgers close roughly every 5 seconds on average, so
dividing the requested lifetime (in seconds) by 5 approximates the number of
ledgers that will elapse. This is an approximation, not a guarantee — actual
ledger close times vary with network conditions, so `expiry_ledger` should
be treated as a best-effort deadline rather than an exact timestamp.

`current_ledger` is read from the latest Horizon/Soroban RPC response at the
time the account is created.

> This formula currently also appears in `README.md` under the temporary
> workarounds section (see "Ledger Expiry Conversion"). Once that section is
> removed, this page becomes the single source of truth — keep this doc in
> sync if the underlying conversion implementation changes.

## Webhooks

### `DELETE /webhooks/:id`

This is a **soft delete**, not a hard delete. The handler sets the
webhook's `isActive` column to `false` and saves the row — it does not
remove it from the `webhooks` table (see
`WebhooksService.remove()` in `src/modules/webhooks/webhooks.service.ts`).

Consequences:

- The row (and its `id`) continue to exist and keep any foreign-key
  relationships, so existing `webhook_deliveries` history for it is
  preserved.
- `GET /webhooks` (`findAll()`) only returns webhooks where
  `isActive: true`, so a deleted webhook disappears from listings even
  though its row still exists.
- Deactivated webhooks stop receiving new deliveries, since
  `triggerEvent()` only queries webhooks with `isActive = true`.
- There is currently no endpoint to hard-delete a webhook row or purge
  its delivery history.
