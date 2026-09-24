import { JwtService } from '@nestjs/jwt';

/**
 * verifyWithRotation
 *
 * Verifies a claim JWT against the current secret, falling back to a
 * previous secret during a rotation grace window, so unclaimed claim
 * tokens (valid up to CLAIM_TOKEN_EXPIRY) issued before a JWT_SECRET
 * rotation still verify (see issue #622). Set JWT_SECRET_PREVIOUS during
 * the rotation window and unset it once CLAIM_TOKEN_EXPIRY has elapsed.
 */
export async function verifyWithRotation(
  jwtService: JwtService,
  token: string,
  previousSecret: string | undefined = process.env.JWT_SECRET_PREVIOUS,
): Promise<unknown> {
  try {
    return await jwtService.verifyAsync(token);
  } catch (err) {
    if (!previousSecret) throw err;
    try {
      return await jwtService.verifyAsync(token, { secret: previousSecret });
    } catch {
      throw err;
    }
  }
}
