import type { Config } from './config.js';
import { charge, PublicError, periods } from './limits.js';
import type { Usage } from './types.js';

/** Synchronous SQLite transactions survive DO eviction; leases recover interrupted streams. */
export class Ledger {
  constructor(
    readonly sql: SqlStorage,
    readonly c: Config,
  ) {
    sql.exec(`CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY,visitor TEXT,ip TEXT,day TEXT,month TEXT,
      created INTEGER,cost REAL,state TEXT,expires INTEGER)`);
    sql.exec('CREATE INDEX IF NOT EXISTS requests_day ON requests(day)');
    sql.exec('CREATE INDEX IF NOT EXISTS requests_month ON requests(month)');
    sql.exec('CREATE INDEX IF NOT EXISTS requests_active ON requests(state,expires)');
  }
  quota(visitor: string, ip: string, now = Date.now()) {
    const p = periods(new Date(now));
    const row = this.sql
      .exec<{ total: number; visitor: number; ip: number; recent: number; cost: number }>(
        `SELECT
      COUNT(*) AS total,COALESCE(SUM(visitor=?),0) AS visitor,COALESCE(SUM(ip=?),0) AS ip,
      COALESCE(SUM(ip=? AND created>=?),0) AS recent,COALESCE(SUM(cost),0) AS cost FROM requests WHERE day=?`,
        visitor,
        ip,
        ip,
        now - 60000,
        p.day,
      )
      .toArray()[0]!;
    const monthly = this.sql
      .exec<{ cost: number }>('SELECT COALESCE(SUM(cost),0) AS cost FROM requests WHERE month=?', p.month)
      .toArray()[0]!.cost;
    return {
      ...row,
      monthly,
      resetsAt: p.reset,
      remaining: Math.max(
        0,
        Math.min(
          this.c.DAILY_VISITOR_LIMIT - row.visitor,
          this.c.DAILY_IP_LIMIT - row.ip,
          this.c.DAILY_GLOBAL_LIMIT - row.total,
        ),
      ),
      available:
        row.cost < this.c.DAILY_BUDGET_CNY && monthly < this.c.MONTHLY_BUDGET_CNY && row.total < this.c.DAILY_GLOBAL_LIMIT,
    };
  }
  reserve(id: string, visitor: string, ip: string, now = Date.now()) {
    this.sql.exec("UPDATE requests SET state='settled' WHERE state='reserved' AND expires<=?", now);
    this.sql.exec('DELETE FROM requests WHERE created<?', now - 90 * 86400000);
    if (this.sql.exec('SELECT id FROM requests WHERE id=?', id).toArray().length)
      throw new PublicError(409, '这条消息已经收到啦');
    const active = this.sql
      .exec<{ visitor: string }>("SELECT visitor FROM requests WHERE state='reserved' AND expires>?", now)
      .toArray();
    if (active.some((r) => r.visitor === visitor) || active.length >= this.c.MAX_CONCURRENT)
      throw new PublicError(429, '稍等一下，等这轮回复结束再来找我');
    const q = this.quota(visitor, ip, now);
    const cost = charge(this.c, this.c.MAX_INPUT_TOKENS, this.c.MAX_OUTPUT_TOKENS);
    if (
      !q.remaining ||
      q.recent >= this.c.IP_PER_MINUTE ||
      q.cost + cost > this.c.DAILY_BUDGET_CNY ||
      q.monthly + cost > this.c.MONTHLY_BUDGET_CNY
    )
      throw new PublicError(429, '先歇一会儿，稍后再来找我吧');
    const p = periods(new Date(now));
    this.sql.exec(
      'INSERT INTO requests VALUES (?,?,?,?,?,?,?,?,?)',
      id,
      visitor,
      ip,
      p.day,
      p.month,
      now,
      cost,
      'reserved',
      now + 120000,
    );
  }
  settle(id: string, called: boolean, usage?: Usage) {
    // Idempotent: never refund a settled/expired reservation on a late retry.
    if (!called) this.sql.exec("DELETE FROM requests WHERE id=? AND state='reserved'", id);
    else if (usage)
      this.sql.exec(
        "UPDATE requests SET cost=?,state='settled' WHERE id=? AND state='reserved'",
        charge(this.c, usage.prompt_tokens, usage.completion_tokens),
        id,
      );
    else this.sql.exec("UPDATE requests SET state='settled' WHERE id=? AND state='reserved'", id);
  }
}
