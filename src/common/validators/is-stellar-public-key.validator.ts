import { registerDecorator, ValidationOptions } from 'class-validator';
import { StrKey } from '@stellar/stellar-sdk';

export function IsStellarPublicKey(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isStellarPublicKey',
      target: object.constructor,
      propertyName,
      options: {
        message: `${propertyName} must be a valid Stellar public key (56 characters, starts with G, valid StrKey checksum)`,
        ...options,
      },
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'string') return false;
          try {
            return StrKey.isValidEd25519PublicKey(value);
          } catch {
            return false;
          }
        },
      },
    });
  };
}
