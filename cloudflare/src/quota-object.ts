import { loadConfig } from './config.js';
import type { Env } from './env.js';
import { Ledger } from './ledger.js';
import { PublicError } from './limits.js';
import type { Usage } from './types.js';

/** Only short internal bookkeeping calls; model streams never run inside this object. */
export class QuotaObject {
  readonly ledger: Ledger;
  constructor(
    readonly state: DurableObjectState,
    env: Env,
  ) {
    this.ledger = new Ledger(state.storage.sql, loadConfig(env));
  }
  async fetch(request: Request) {
    const value = (await request.json()) as {
      action: string;
      id: string;
      visitor: string;
      ip: string;
      called: boolean;
      usage?: Usage;
    };
    try {
      const result = this.state.storage.transactionSync(() => {
        if (value.action === 'reserve') this.ledger.reserve(value.id, value.visitor, value.ip);
        else if (value.action === 'settle') this.ledger.settle(value.id, value.called, value.usage);
        else if (value.action !== 'quota') throw new PublicError(400, 'Unknown action');
        const { remaining, resetsAt, available } = this.ledger.quota(value.visitor, value.ip);
        return { remaining, resetsAt, available };
      });
      return Response.json(result);
    } catch (error) {
      if (error instanceof PublicError) return Response.json({ message: `${error.message}喵~` }, { status: error.status });
      return Response.json({ message: '让我歇一会儿再陪你聊喵~' }, { status: 503 });
    }
  }
}
