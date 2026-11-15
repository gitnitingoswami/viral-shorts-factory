import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

/**
 * Short-lived signed media URLs, so <video>/<img>/<track> elements (which cannot send an Authorization header)
 * can load private assets. The key is derived from the access-token secret with HKDF and a distinct label, so a
 * media signature can never be used as a token and vice versa.
 */
export class MediaSigner {
  private readonly key: Buffer;

  constructor(secret: string) {
    this.key = Buffer.from(hkdfSync('sha256', secret, 'vsf', 'media-url-v1', 32));
  }

  sign(assetId: string, expiresAtSec: number): string {
    return createHmac('sha256', this.key).update(`${assetId}.${expiresAtSec}`).digest('base64url');
  }

  verify(assetId: string, expiresAtSec: number, signature: string, nowSec = Math.floor(Date.now() / 1000)): boolean {
    if (!Number.isInteger(expiresAtSec) || expiresAtSec < nowSec) return false;
    const expected = Buffer.from(this.sign(assetId, expiresAtSec));
    const given = Buffer.from(signature);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }
}
