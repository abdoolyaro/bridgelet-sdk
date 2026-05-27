import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsObject,
  Min,
  Max,
  Matches,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { IsStellarPublicKey } from '../../../common/validators/is-stellar-public-key.validator.js';

const STELLAR_ASSET_REGEX = /^(native|[A-Z0-9]{1,12}:G[A-Z0-9]{55})$/;

export class CreateAccountDto {
  @ApiProperty({
    example: 'GSENDER...',
    description:
      'Stellar public key of the funding account. Must be 56 characters, ' +
      'start with G, and contain only uppercase alphanumeric characters.',
  })
  @IsString()
  @IsNotEmpty()
  @IsStellarPublicKey()
  fundingSource: string;

  @ApiProperty({ example: '100', description: 'Payment amount' })
  @IsString()
  @IsNotEmpty()
  amount: string;

  @ApiProperty({
    example: 'USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    description:
      'Asset to use for the ephemeral account. ' +
      'Use "native" for XLM, or CODE:ISSUER for issued assets ' +
      '(e.g. USDC:G...). CODE is 1 - 12 uppercase alphanumeric characters; ' +
      'ISSUER must be a valid Stellar public key.',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(STELLAR_ASSET_REGEX, {
    message:
      'asset must be "native" (for XLM) or in the format CODE:ISSUER ' +
      '(e.g. USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5), ' +
      'where CODE is 1 - 12 uppercase alphanumeric characters and ISSUER is a valid Stellar public key',
  })
  asset: string;

  @ApiProperty({
    example: 2592000,
    description: 'Expiry in seconds (1 hour - 30 days)',
  })
  @IsNumber()
  @Min(3600) // 1 hour
  @Max(2592000) // 30 days
  expiresIn: number;

  @ApiProperty({ example: { userId: 'user_123' }, required: false })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}
