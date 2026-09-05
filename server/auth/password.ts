/**
 * server/auth/password.ts —— scrypt 密码哈希 + token 生成。
 *
 * scrypt 参数：N=2^15（32768），r=8，p=1，keylen=64 bytes。
 * 对比 bcrypt cost=12：scrypt N=2^15 对 GPU/ASIC 爆破抗性更高（内存硬）。
 * 盐随机 16 bytes；hash 64 bytes → 输出 hex 共 128 字符。
 */

import crypto from 'node:crypto';

const SCRYPT_N = 32768; // 2^15
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;

export interface PasswordHashResult {
  hash: string;
  salt: string;
}

export function hashPassword(plain: string): PasswordHashResult {
  if (typeof plain !== 'string' || plain === '') {
    throw new Error('password must be non-empty string');
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = scryptSync(plain, salt);
  return { hash, salt };
}

export function verifyPassword(plain: string, salt: string, expectedHash: string): boolean {
  if (typeof plain !== 'string' || typeof salt !== 'string' || typeof expectedHash !== 'string') {
    return false;
  }
  try {
    const actual = scryptSync(plain, salt);
    return timingSafeEqualHex(actual, expectedHash);
  } catch {
    return false;
  }
}

function scryptSync(plain: string, saltHex: string): string {
  const saltBuf = Buffer.from(saltHex, 'hex');
  const derived = crypto.scryptSync(plain.normalize('NFKC'), saltBuf, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 128 * SCRYPT_N * SCRYPT_R * 2,
  });
  return derived.toString('hex');
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    const bufA = Buffer.from(a, 'hex');
    const bufB = Buffer.from(b, 'hex');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

/** 32 字节随机 token，base64url 编码（256 位熵） */
export function generateToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/** SHA-256 HMAC 签名（用于 cookie 完整性或 CSRF token） */
export function hmacSign(secret: string, payload: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/** 密码强度校验：≥10 字符 + 含字母 + 含数字（或显式 admin-only 弱密码白名单） */
export function validatePasswordStrength(plain: string, allowWeak = false): { ok: boolean; reason?: string } {
  if (typeof plain !== 'string') return { ok: false, reason: '密码必须为字符串' };
  if (plain.length === 0) return { ok: false, reason: '密码不能为空' };
  if (allowWeak) return { ok: true }; // 启动期 / 测试环境：仅校验非空
  if (plain.length < 10) return { ok: false, reason: '密码至少 10 字符' };
  const hasLetter = /[A-Za-z]/.test(plain);
  const hasDigit = /[0-9]/.test(plain);
  if (!hasLetter || !hasDigit) return { ok: false, reason: '密码需含字母和数字' };
  return { ok: true };
}
