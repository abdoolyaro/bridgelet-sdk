import { validate } from 'class-validator';
import { IsStellarPublicKey } from './is-stellar-public-key.validator.js';

class Dto {
  @IsStellarPublicKey()
  key!: string;
}

const VALID = 'GDV3BRGE2BXK5JMGAEDGE5QWAY2DBK5V2KEG762Y5GH4LPC5RSPRPTTJ';
// Same length/prefix/charset as VALID, but last char tampered so the
// StrKey CRC16 checksum no longer matches the payload.
const CHECKSUM_INVALID =
  'GDV3BRGE2BXK5JMGAEDGE5QWAY2DBK5V2KEG762Y5GH4LPC5RSPRPTTA';

describe('IsStellarPublicKey (StrKey checksum audit)', () => {
  it('accepts a key with a valid StrKey checksum', async () => {
    const dto = Object.assign(new Dto(), { key: VALID });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects a format-valid but checksum-invalid key', async () => {
    const dto = Object.assign(new Dto(), { key: CHECKSUM_INVALID });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
  });

  it.each([
    'not-a-key',
    '',
    'MDV3BRGE2BXK5JMGAEDGE5QWAY2DBK5V2KEG762Y5GH4LPC5RSPRPTTJ', // wrong prefix
    'G0000000000000000000000000000000000000000000000000000', // '0' isn't valid base32
  ])('rejects malformed input %p', async (key) => {
    const dto = Object.assign(new Dto(), { key });
    expect(await validate(dto)).toHaveLength(1);
  });
});
