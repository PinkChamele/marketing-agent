import { BlockReason } from './enums/block-reason.enum';
import { SignalGroup } from './types';

export const SUSPICIOUSLY_SHORT_THRESHOLD = 200;
export const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Real-content threshold. A page with a known block signal AND less than
 * 3x this many characters is treated as blocked. A long article that
 * mentions "sign in" in a footer stays above the threshold and is fine.
 */
export const MIN_REAL_CONTENT = 400;

export const BLOCK_SIGNALS: SignalGroup[] = [
  {
    reason: BlockReason.LoginWall,
    patterns: [
      /sign\s?in/i,
      /log\s?in to (continue|read|view)/i,
      /create an account/i,
      /business email address/i,
    ],
  },
  {
    reason: BlockReason.Captcha,
    patterns: [
      /cloudflare/i,
      /turnstile/i,
      /verify you are human/i,
      /checking your browser/i,
      /security challenge/i,
    ],
  },
  {
    reason: BlockReason.PayWall,
    patterns: [
      /subscribe to (read|continue)/i,
      /this (article|content) is for subscribers/i,
      /premium content/i,
    ],
  },
];
