export async function consumeStream(response: Response, onEvent: (event: string, value: unknown) => void) {
  if (!response.ok) {
    const result = (await response.json().catch(() => ({}))) as { message?: string; retryAt?: unknown };
    throw new ChatError(
      typeof result.message === 'string' ? result.message : '等会儿再陪你看看喵~',
      typeof result.retryAt === 'number' ? result.retryAt : undefined,
    );
  }
  if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('回复连接异常。');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let completed = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
      pending = pending.replaceAll('\r\n', '\n');
      if (pending.length > 100000) throw new Error('回复数据超过限制。');
      while (true) {
        const end = pending.indexOf('\n\n');
        if (end < 0) break;
        const frame = pending.slice(0, end);
        pending = pending.slice(end + 2);
        const event = frame
          .split('\n')
          .find((line) => line.startsWith('event:'))
          ?.slice(6)
          .trim();
        const data = frame
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        if (event && data) {
          onEvent(event, JSON.parse(data));
          if (event === 'done') completed = true;
        }
      }
      if (done) break;
    }
    if (!completed) throw new Error('回复中断，已有内容已保留。');
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
/** Only intentional visitor-facing messages may reach the chat status area. */
export class ChatError extends Error {
  constructor(
    message: string,
    readonly retryAt?: number,
  ) {
    super(message);
  }
}
