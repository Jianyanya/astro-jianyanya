import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';

const schema = z.object({
  authenticated: z.boolean(),
  authConfigured: z.boolean().default(true),
  user: z.object({ id: z.string(), login: z.string() }).optional(),
  remaining: z.number().nonnegative(),
  available: z.boolean(),
  retryAt: z.number().default(0),
});

/** Only status requests run here; opening or counting down never starts a model request. */
export function useChatAccess(open: boolean) {
  const [access, setAccess] = useState<z.infer<typeof schema>>();
  const [fault, setFault] = useState('');
  const [now, setNow] = useState(Date.now);
  const active = useRef<AbortController | null>(null);
  const refresh = useCallback(() => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    void fetch('/api/lingyue/quota', { credentials: 'same-origin', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Quota unavailable');
        const data = schema.parse(await response.json());
        if (controller.signal.aborted) return;
        setAccess(data);
        setNow(Date.now());
        setFault('');
      })
      .catch(() => {
        if (!controller.signal.aborted) setFault('刚才没接上，点一下刷新状态再来找我喵~');
      });
  }, []);
  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => {
    const until = access?.retryAt ?? 0;
    if (!open || until <= Date.now()) return;
    const timer = window.setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= until) {
        window.clearInterval(timer);
        refresh();
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [access?.retryAt, open, refresh]);
  const deferUntil = (until: number) => {
    if (!Number.isFinite(until)) return;
    setNow(Date.now());
    setAccess((previous) => previous && { ...previous, available: false, retryAt: Math.max(previous.retryAt, until) });
  };
  const logout = async () => {
    active.current?.abort();
    try {
      const response = await fetch('/api/lingyue/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!response.ok) {
        setFault('退出没接上，稍后再试试喵~');
        return false;
      }
      setAccess({ authenticated: false, authConfigured: true, remaining: 0, available: false, retryAt: 0 });
      setFault('');
      return true;
    } catch {
      setFault('退出没接上，稍后再试试喵~');
      return false;
    }
  };
  const cooldown = Math.max(0, Math.ceil(((access?.retryAt ?? 0) - now) / 1000));
  return {
    access,
    fault,
    refresh,
    logout,
    deferUntil,
    cooldown,
    canSend: Boolean(access?.authenticated && access.available && cooldown === 0 && !fault),
  };
}
