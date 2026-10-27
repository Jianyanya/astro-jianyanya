import { createHmac } from 'node:crypto';
import type { Config } from './config.js';

export class PublicError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryAt?: number,
  ) {
    super(message);
  }
}

export const ipHash = (ip: string, secret: string) => createHmac('sha256', secret).update(`ip:${ip}`).digest('hex');

export function periods(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  const day = `${get('year')}-${get('month')}-${get('day')}`;
  const reset = new Date(`${day}T00:00:00+08:00`).getTime() + 86400000;
  return { day, month: day.slice(0, 7), reset: new Date(reset).toISOString() };
}

export function charge(c: Config, input: number, output: number) {
  // Peak cache-miss price is deliberately used even on cache hits/off-peak hours.
  return (
    ((input * c.CHAT_INPUT_USD_PER_MILLION + output * c.CHAT_OUTPUT_USD_PER_MILLION) * c.USD_TO_CNY_BUDGET_RATE) / 1_000_000
  );
}
