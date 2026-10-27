import { ErrorBoundary } from '@components/common/ErrorBoundary';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { MessageBody } from './MessageBody';
import { ChatError, consumeStream } from './stream';
import { useChatAccess } from './useChatAccess';
import './lingyue.css';

const sourceSchema = z.object({
  id: z.string(),
  title: z.string(),
  heading: z.string(),
  url: z
    .string()
    .startsWith('/')
    .refine((url) => !url.startsWith('//') && !/[\\\p{Cc}]/u.test(url)),
  cited: z.boolean(),
});
type Source = z.infer<typeof sourceSchema>;
interface Turn {
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
  complete?: boolean;
}
const historySchema = z
  .array(
    z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string().max(24000),
      sources: z.array(sourceSchema).optional(),
      complete: z.boolean().optional(),
    }),
  )
  .max(24);
const storageKey = 'belluna:lingyue:session:v1';

function Panel() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [waitingForCooldown, setWaitingForCooldown] = useState(false);
  const [outcome, setOutcome] = useState<'idle' | 'complete' | 'interrupted' | 'error'>('idle');
  const { access, fault, refresh: refreshQuota, logout, deferUntil, cooldown, canSend } = useChatAccess(open);
  const [historyOwner, setHistoryOwner] = useState('');
  const [articleId, setArticleId] = useState('');
  const controller = useRef<AbortController | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  useEffect(() => {
    if (waitingForCooldown && cooldown === 0 && canSend) {
      setError('');
      setWaitingForCooldown(false);
    }
  }, [waitingForCooldown, cooldown, canSend]);

  useEffect(() => {
    const result = new URL(window.location.href).searchParams.get('lingyue_login');
    if (result === 'failed' || result === 'cancelled') setError('登录没接上，想聊的时候再点一下 GitHub 登录喵~');
    const show = () => {
      setOpen(true);
      refreshQuota();
    };
    const syncArticle = () =>
      setArticleId(document.querySelector<HTMLElement>('[data-lingyue-context]')?.dataset.articleId ?? '');
    const retract = () => setOpen(false);
    syncArticle();
    if (document.documentElement.dataset.lingyueOpen === 'true') show();
    window.addEventListener('koharu:lingyue-open', show);
    window.addEventListener('koharu:lingyue-retract', retract);
    document.addEventListener('astro:page-load', syncArticle);
    return () => {
      window.removeEventListener('koharu:lingyue-open', show);
      window.removeEventListener('koharu:lingyue-retract', retract);
      document.removeEventListener('astro:page-load', syncArticle);
      controller.current?.abort();
    };
  }, [refreshQuota]);
  useEffect(() => {
    const account = access?.user?.id ?? '';
    let restored: Turn[] = [];
    if (account)
      try {
        const saved = historySchema.safeParse(JSON.parse(sessionStorage.getItem(`${storageKey}:${account}`) ?? '[]'));
        if (saved.success) restored = saved.data.filter((turn) => turn.complete);
      } catch {
        /* Optional in privacy modes. */
      }
    setMessages(restored);
    setHistoryOwner(account);
  }, [access?.user?.id]);
  useEffect(() => {
    if (!access?.user?.id || historyOwner !== access.user.id) return;
    try {
      sessionStorage.setItem(`${storageKey}:${historyOwner}`, JSON.stringify(messages.slice(-24)));
    } catch {
      /* Optional. */
    }
  }, [messages, historyOwner, access?.user?.id]);
  useEffect(() => {
    if (open) {
      dialog.current?.show();
      textarea.current?.focus();
    } else dialog.current?.close();
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !open || document.querySelector('dialog:modal')) return;
      event.preventDefault();
      window.dispatchEvent(new Event('koharu:lingyue-close-request'));
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [open]);
  // Scroll only while the panel is visible. Avoid animation on every token.
  useEffect(() => {
    if (open && followLatest.current && (messages.length || status)) bottom.current?.scrollIntoView({ block: 'nearest' });
  }, [messages, status, open]);
  const speaking = busy && Boolean(messages.at(-1)?.content);
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('koharu:lingyue-state', {
        detail: { open, busy, hasDraft: Boolean(draft.trim()), speaking, outcome },
      }),
    );
  }, [open, busy, draft, speaking, outcome]);

  function close() {
    window.dispatchEvent(new Event('koharu:lingyue-close-request'));
  }
  async function send() {
    const message = draft.trim();
    if (!message || busy || controller.current || !canSend) return;
    followLatest.current = true;
    const abort = new AbortController();
    controller.current = abort;
    const history = messages
      .filter((turn) => turn.complete && turn.content)
      .slice(-8)
      .map(({ role, content }) => ({ role, content: content.slice(0, 6000) }));
    setMessages((turns) => [
      ...turns.slice(-22),
      { role: 'user', content: message, complete: true },
      { role: 'assistant', content: '', complete: false },
    ]);
    setDraft('');
    setError('');
    setWaitingForCooldown(false);
    setOutcome('idle');
    setBusy(true);
    setStatus('让我翻翻博客里的资料喵~');
    const updateLast = (fn: (turn: Turn) => Turn) =>
      setMessages((turns) => turns.map((turn, index) => (index === turns.length - 1 ? fn(turn) : turn)));
    try {
      const response = await fetch('/api/lingyue/chat', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        signal: abort.signal,
        body: JSON.stringify({ message, history, articleId: articleId || undefined, requestId: crypto.randomUUID() }),
      });
      await consumeStream(response, (event, value) => {
        if (event === 'delta') {
          const data = z.object({ text: z.string() }).parse(value);
          updateLast((turn) => ({ ...turn, content: turn.content + data.text }));
        } else if (event === 'status') setStatus(z.object({ message: z.string() }).parse(value).message);
        else if (event === 'sources')
          updateLast((turn) => ({ ...turn, sources: z.object({ sources: z.array(sourceSchema) }).parse(value).sources }));
        else if (event === 'done') updateLast((turn) => ({ ...turn, complete: true }));
        else if (event === 'error') {
          const data = z.object({ message: z.string(), retryAt: z.number().optional() }).parse(value);
          throw new ChatError(data.message, data.retryAt);
        }
      });
      setOutcome('complete');
    } catch (cause) {
      if (cause instanceof ChatError && cause.retryAt) {
        deferUntil(cause.retryAt);
        setWaitingForCooldown(true);
      }
      setOutcome(abort.signal.aborted ? 'interrupted' : 'error');
      setError(
        abort.signal.aborted
          ? '先聊到这里，已经说过的话我留着喵~'
          : cause instanceof ChatError
            ? cause.message
            : '刚才没能把话说完，等会儿再陪你看看喵~',
      );
    } finally {
      controller.current = null;
      setBusy(false);
      setStatus('');
      refreshQuota();
    }
  }
  const accessMessage =
    access?.authenticated && !busy && !access.available && cooldown === 0
      ? access.remaining === 0
        ? '今天先聊到这里，明天再来找我喵~'
        : '我这会儿要休息一下，稍后再来找我喵~'
      : '';
  return (
    <dialog
      id="lingyue-dialog"
      ref={dialog}
      className="lingyue-dialog"
      aria-labelledby="lingyue-title"
      aria-modal="false"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div className="lingyue-panel">
        <header className="lingyue-header">
          <img src="/img/avatar.webp" alt="铃月" width={44} height={44} />
          <div>
            <h2 id="lingyue-title">铃月 · Belluna</h2>
            <p>铃响之处，月色回应。</p>
          </div>
          <button type="button" onClick={close} aria-label="关闭对话">
            ×
          </button>
        </header>
        <div
          className="lingyue-conversation"
          role="log"
          aria-label="对话记录"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need to focus and scroll the conversation.
          tabIndex={0}
          onScroll={(event) => {
            const element = event.currentTarget;
            followLatest.current = element.scrollHeight - element.clientHeight - element.scrollTop < 48;
          }}
        >
          {messages.length === 0 && (
            <div className="lingyue-welcome">
              <p>欢迎来到 Belluna，我是猫娘女仆铃月喵~</p>
              <p>想看看这里的项目，还是和我一起读篇文章喵~</p>
              {['介绍一下博客里的项目', '铃月助手是怎么设计的？'].map((question) => (
                <button
                  type="button"
                  key={question}
                  onClick={() => {
                    setDraft(question);
                    textarea.current?.focus();
                  }}
                >
                  {question}
                </button>
              ))}
            </div>
          )}
          {messages.map((turn, index) => (
            <div key={`${index}-${turn.role}`} className={`lingyue-message lingyue-${turn.role}`}>
              <span className="lingyue-speaker">{turn.role === 'user' ? '你' : '铃月'}</span>
              {turn.role === 'assistant' ? (
                <MessageBody text={turn.content || (busy ? '…' : '等会儿再陪你看看喵~')} />
              ) : (
                <div className="lingyue-user-text">{turn.content}</div>
              )}
              {turn.sources && turn.sources.length > 0 && (
                <details className="lingyue-sources">
                  <summary>引用与相关资料 · {turn.sources.length}</summary>
                  {turn.sources.map((source) => (
                    <a key={source.id} href={source.url} target="_blank" rel="noopener noreferrer">
                      [{source.id}] {source.title}
                      {source.heading ? ` · ${source.heading}` : ''}
                      <small>{source.cited ? '已引用' : '相关资料'}</small>
                    </a>
                  ))}
                </details>
              )}
              {turn.role === 'assistant' && turn.complete === false && !busy && turn.content && <small>先说到这里喵~</small>}
            </div>
          ))}
          <div ref={bottom} />
        </div>
        <output className="lingyue-status" aria-live="polite">
          {fault ||
            accessMessage ||
            error ||
            status ||
            (access && !access.authenticated
              ? '用 GitHub 登录后，就能和我聊天喵~'
              : articleId
                ? '正在阅读文章，可直接问“这篇文章…”'
                : '可检索博客公开文章')}
          {access?.authenticated && <span>今日剩余 {access.remaining} 次</span>}
        </output>
        <form
          className="lingyue-form"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          {access && !access.authenticated && (
            <div className="lingyue-signin">
              {access.authConfigured ? (
                <a
                  href={`/api/lingyue/auth/login?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`}
                >
                  使用 GitHub 登录
                </a>
              ) : (
                <p>登录入口还在准备，稍后再来找我喵~</p>
              )}
              <small>每个 GitHub 账号每天 20 次，次日零点恢复。</small>
            </div>
          )}
          {access?.user && (
            <div className="lingyue-account">
              <span>GitHub · {access.user.login}</span>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  if (await logout()) {
                    try {
                      sessionStorage.removeItem(`${storageKey}:${access.user!.id}`);
                    } catch {
                      /* Optional. */
                    }
                    setMessages([]);
                    setDraft('');
                    setError('');
                  }
                }}
              >
                退出登录
              </button>
            </div>
          )}
          <label className="sr-only" htmlFor="lingyue-message">
            给铃月的消息
          </label>
          <textarea
            id="lingyue-message"
            ref={textarea}
            value={draft}
            maxLength={2000}
            rows={2}
            disabled={!access?.authenticated}
            placeholder={access?.authenticated ? '和铃月聊聊…' : '登录后和铃月聊聊…'}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <div className="lingyue-actions">
            {(fault || (access?.authenticated && !access.available && cooldown === 0)) && (
              <button type="button" onClick={refreshQuota}>
                刷新状态
              </button>
            )}
            {error && !busy && (
              <button
                type="button"
                onClick={() => {
                  setDraft(messages.filter((turn) => turn.role === 'user').at(-1)?.content ?? '');
                  textarea.current?.focus();
                }}
              >
                重新填写上次问题
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setMessages([]);
                setError('');
              }}
            >
              清空对话
            </button>
            {busy ? (
              <button type="button" onClick={() => controller.current?.abort()}>
                停止生成
              </button>
            ) : (
              <button type="submit" disabled={!draft.trim() || !canSend}>
                {cooldown > 0 ? `${cooldown} 秒后可发送` : '发送'}
              </button>
            )}
          </div>
          <p>免费体验 · 对话仅在本标签页暂存，回复时会发送给模型服务。AI 回答请结合原文核对。</p>
        </form>
      </div>
    </dialog>
  );
}

export default function LingyueChat() {
  return (
    <ErrorBoundary fallback={<p className="lingyue-fallback">刚才没接上话，刷新一下再来找我喵~</p>}>
      <Panel />
    </ErrorBoundary>
  );
}
