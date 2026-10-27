import type { Config } from './config.js';
import type { Database, Query } from './database.js';
import { charge, PublicError, periods } from './limits.js';
import type { Usage } from './types.js';

export class Ledger {
  constructor(
    readonly db: Database,
    readonly c: Config,
  ) {}
  private async status(db: Query, visitor: string, ip: string, now: number) {
    const p = periods(new Date(now));
    const [row] = await db.query<{
      total: number;
      visitor: number;
      ip: number;
      recent: number;
      cost: number;
      last_created: string | null;
    }>(
      `SELECT count(*)::int AS total,
       count(*) FILTER(WHERE visitor=$1)::int AS visitor,
       count(*) FILTER(WHERE ip=$2)::int AS ip,
       count(*) FILTER(WHERE ip=$2 AND created>=$3)::int AS recent,
       coalesce(sum(cost),0)::float8 AS cost,
       max(created) FILTER(WHERE visitor=$1) AS last_created FROM lingyue.requests WHERE day=$4`,
      [visitor, ip, now - 60000, p.day],
    );
    const [month] = await db.query<{ cost: number }>(
      'SELECT coalesce(sum(cost),0)::float8 AS cost FROM lingyue.requests WHERE month=$1',
      [p.month],
    );
    const remaining = Math.max(
      0,
      Math.min(
        this.c.DAILY_VISITOR_LIMIT - row!.visitor,
        this.c.DAILY_IP_LIMIT - row!.ip,
        this.c.DAILY_GLOBAL_LIMIT - row!.total,
      ),
    );
    const [gate] = await db.query<{ cooldown_until: string; next_start: string }>(
      'SELECT cooldown_until,next_start FROM lingyue.quota_lock WHERE id=1',
    );
    const retryAt = Math.max(
      Number(gate?.cooldown_until ?? 0),
      Number(gate?.next_start ?? 0),
      row?.last_created ? Number(row.last_created) + this.c.USER_COOLDOWN_SECONDS * 1000 : 0,
    );
    const reservation = charge(this.c, this.c.MAX_INPUT_TOKENS, this.c.MAX_OUTPUT_TOKENS);
    return {
      ...row!,
      monthly: month!.cost,
      remaining,
      resetsAt: p.reset,
      retryAt,
      available:
        remaining > 0 &&
        retryAt <= now &&
        row!.cost + reservation <= this.c.DAILY_BUDGET_CNY &&
        month!.cost + reservation <= this.c.MONTHLY_BUDGET_CNY,
    };
  }
  async quota(visitor: string, ip: string, now = Date.now()) {
    return this.status(this.db, visitor, ip, now);
  }
  async reserve(id: string, visitor: string, ip: string, now = Date.now()) {
    return this.db.transaction(async (db) => {
      // Serialize checks + reservation across every serverless instance, not just this process.
      await db.query('SELECT id FROM lingyue.quota_lock WHERE id=1 FOR UPDATE');
      await db.query("UPDATE lingyue.requests SET state='settled' WHERE state='reserved' AND expires<=$1", [now]);
      await db.query('DELETE FROM lingyue.requests WHERE created<$1', [now - 90 * 86400000]);
      if ((await db.query('SELECT id FROM lingyue.requests WHERE id=$1', [id])).length)
        throw new PublicError(409, '这条消息已经收到啦喵~');
      const active = await db.query<{ visitor: string }>(
        "SELECT visitor FROM lingyue.requests WHERE state='reserved' AND expires>$1",
        [now],
      );
      if (active.some((r) => r.visitor === visitor) || active.length >= this.c.MAX_CONCURRENT)
        throw new PublicError(429, '稍等一下，等这轮回复结束再来找我喵~', now + 3000);
      const q = await this.status(db, visitor, ip, now);
      if (q.retryAt > now) throw new PublicError(429, '让我歇一小会儿，倒计时结束再来找我喵~', q.retryAt);
      const cost = charge(this.c, this.c.MAX_INPUT_TOKENS, this.c.MAX_OUTPUT_TOKENS);
      if (q.recent >= this.c.IP_PER_MINUTE) throw new PublicError(429, '让我歇一小会儿，再慢慢聊喵~', now + 60000);
      if (!q.remaining || q.cost + cost > this.c.DAILY_BUDGET_CNY || q.monthly + cost > this.c.MONTHLY_BUDGET_CNY)
        throw new PublicError(429, '先歇一会儿，稍后再来找我吧喵~');
      const p = periods(new Date(now));
      await db.query(`INSERT INTO lingyue.requests VALUES ($1,$2,$3,$4,$5,$6,$7,'reserved',$8)`, [
        id,
        visitor,
        ip,
        p.day,
        p.month,
        now,
        cost,
        now + 120000,
      ]);
      await db.query('UPDATE lingyue.quota_lock SET next_start=$1 WHERE id=1', [
        now + this.c.MODEL_START_INTERVAL_SECONDS * 1000,
      ]);
    });
  }
  /** Shared circuit breaker: every Vercel instance respects the same provider backoff. */
  async coolDown(seconds: number, now = Date.now()) {
    const retryAt = now + Math.max(this.c.MODEL_COOLDOWN_SECONDS, seconds) * 1000;
    await this.db.query('UPDATE lingyue.quota_lock SET cooldown_until=greatest(cooldown_until,$1) WHERE id=1', [retryAt]);
    return retryAt;
  }
  async settle(id: string, called: boolean, usage?: Usage) {
    return this.db.transaction(async (db) => {
      await db.query('SELECT id FROM lingyue.quota_lock WHERE id=1 FOR UPDATE');
      if (!called) await db.query("DELETE FROM lingyue.requests WHERE id=$1 AND state='reserved'", [id]);
      else if (usage)
        await db.query("UPDATE lingyue.requests SET cost=$2,state='settled' WHERE id=$1 AND state='reserved'", [
          id,
          charge(this.c, usage.prompt_tokens, usage.completion_tokens),
        ]);
      else await db.query("UPDATE lingyue.requests SET state='settled' WHERE id=$1 AND state='reserved'", [id]);
    });
  }
}
