import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  env: process.env.NODE_ENV ?? 'development',
  jwtSecret: process.env.JWT_SECRET ?? 'change-me-in-production',
  corsOrigins: process.env.CORS_ORIGINS?.split(',') || '*',
  apiRateLimit: parseInt(process.env.API_RATE_LIMIT ?? '100', 10),
  claimTokenExpiry: parseInt(process.env.CLAIM_TOKEN_EXPIRY ?? '2592000', 10),
  claimBaseUrl: process.env.CLAIM_BASE_URL || 'https://claim.bridgelet.io',
  webhookRetryAttempts: parseInt(process.env.WEBHOOK_RETRY_ATTEMPTS ?? '3', 10),
  webhookTimeout: parseInt(process.env.WEBHOOK_TIMEOUT ?? '5000', 10),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  paymentPollIntervalMs: parseInt(
    process.env.PAYMENT_POLL_INTERVAL_MS ?? '30000',
    10,
  ),
  expiryCheckIntervalMs: parseInt(
    process.env.EXPIRY_CHECK_INTERVAL_MS ?? '300000',
    10,
  ),
  initializingCleanupIntervalMs: parseInt(
    process.env.INITIALIZING_CLEANUP_INTERVAL_MS ?? '900000',
    10,
  ),
  initializingTimeoutMs: parseInt(
    process.env.INITIALIZING_TIMEOUT_MS ?? '600000',
    10,
  ),
  kmsEnabled: process.env.KMS_ENABLED !== 'false',
  kmsKeyId: process.env.KMS_KEY_ID,
  awsRegion: process.env.AWS_REGION ?? 'us-east-1',
}));
