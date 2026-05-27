import { registerDecorator, ValidationOptions } from 'class-validator';

const STELLAR_PUBLIC_KEY_REGEX = /^G[A-Z0-9]{55}$/;

export function IsStellarPublicKey(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isStellarPublicKey',
      target: object.constructor,
      propertyName,
      options: {
        message: `${propertyName} must be a valid Stellar public key (56 characters, starts with G, uppercase alphanumeric only)`,
        ...options,
      },
      validator: {
        validate(value: unknown) {
          return (
            typeof value === 'string' && STELLAR_PUBLIC_KEY_REGEX.test(value)
          );
        },
      },
    });
  };
}
