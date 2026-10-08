import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password,salt,64).toString('hex')}`;
}
export function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const expected = Buffer.from(hash,'hex');
  const actual = scryptSync(password,salt,64);
  return expected.length === actual.length && timingSafeEqual(expected,actual);
}
export const tokenHash = token => createHash('sha256').update(token).digest('hex');
