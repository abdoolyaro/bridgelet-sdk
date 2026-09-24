import { BadRequestException } from '@nestjs/common';
import {
  sanitizeMetadata,
  METADATA_MAX_BYTES,
} from './metadata-sanitizer.util.js';

describe('sanitizeMetadata', () => {
  it('returns undefined for null input', () => {
    expect(sanitizeMetadata(null)).toBeUndefined();
  });

  it('returns undefined for undefined input', () => {
    expect(sanitizeMetadata(undefined)).toBeUndefined();
  });

  it('passes through safe keys unchanged', () => {
    const result = sanitizeMetadata({ userId: 'u123', orderId: 'o456' });
    expect(result).toEqual({ userId: 'u123', orderId: 'o456' });
  });

  it('strips top-level PII keys: email, phone', () => {
    const result = sanitizeMetadata({
      userId: 'u1',
      email: 'user@example.com',
      phone: '555-1234',
    });
    expect(result).not.toHaveProperty('email');
    expect(result).not.toHaveProperty('phone');
    expect(result).toHaveProperty('userId', 'u1');
  });

  it('strips PII keys case-insensitively (Email, PHONE)', () => {
    const result = sanitizeMetadata({ Email: 'x@y.com', PHONE: '1234' });
    expect(result).not.toHaveProperty('Email');
    expect(result).not.toHaveProperty('PHONE');
  });

  it.each([
    'email',
    'phone',
    'phonenumber',
    'mobile',
    'ssn',
    'dob',
    'dateofbirth',
    'address',
    'fullname',
    'firstname',
    'lastname',
    'name',
    'nationalid',
    'passport',
    'taxid',
  ])('strips the PII key "%s"', (key) => {
    const result = sanitizeMetadata({ [key]: 'sensitive', safe: 'ok' });
    expect(result).not.toHaveProperty(key);
    expect(result).toHaveProperty('safe', 'ok');
  });

  it('throws BadRequestException when metadata exceeds METADATA_MAX_BYTES', () => {
    const large = { data: 'x'.repeat(METADATA_MAX_BYTES + 1) };
    expect(() => sanitizeMetadata(large)).toThrow(BadRequestException);
  });

  it('accepts metadata exactly at the byte limit', () => {
    // Build a payload whose JSON serialisation is exactly METADATA_MAX_BYTES
    const value = 'x'.repeat(METADATA_MAX_BYTES - '{"data":""}'.length);
    const result = sanitizeMetadata({ data: value });
    expect(result).toHaveProperty('data');
  });

  it('returns an empty object when all keys are PII', () => {
    const result = sanitizeMetadata({ email: 'a@b.com', phone: '123' });
    expect(result).toEqual({});
  });

  it.each(['__proto__', 'constructor', 'prototype'])(
    'drops the dangerous key "%s" without polluting the object prototype',
    (key) => {
      const payload = JSON.parse(
        `{"${key}": {"polluted": true}, "safe": "ok"}`,
      );
      const result = sanitizeMetadata(payload) as Record<string, unknown>;
      expect(result).toHaveProperty('safe', 'ok');
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
      expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    },
  );
});
