# API Reference

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
