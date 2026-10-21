const RETRACT_AFTER_MS = 45000;

interface ChatState {
  open: boolean;
  busy: boolean;
  hasDraft: boolean;
  speaking: boolean;
  outcome?: 'idle' | 'complete' | 'interrupted' | 'error';
}

function positionDock(root: HTMLElement) {
  root.style.removeProperty('--lingyue-dock-width');
  root.style.removeProperty('--lingyue-dock-left');
  const article =
    document.querySelector<HTMLElement>('main article.prose') ??
    document.querySelector<HTMLElement>('main .two-column-content > div:last-child');
  if (!article || window.innerWidth <= 992) return;
  const textLeft = Math.floor(article.getBoundingClientRect().left);
  const width = Math.min(336, textLeft - 36);
  if (width < 240) return;
  // Float over the sidebar, leaving a 24px gap before the unchanged article.
  root.style.setProperty('--lingyue-dock-width', `${width}px`);
  root.style.setProperty('--lingyue-dock-left', `${textLeft - width - 24}px`);
}

function attach(root: HTMLElement) {
  const buttonNode = root.querySelector<HTMLButtonElement>('#lingyue-launcher');
  const hintNode = root.querySelector<HTMLElement>('.lingyue-character-hint');
  if (!buttonNode || !hintNode) return () => {};
  const launcher: HTMLButtonElement = buttonNode;
  const hint: HTMLElement = hintNode;
  const listeners = new AbortController();
  const options = { signal: listeners.signal };
  let state: ChatState = { open: false, busy: false, hasDraft: false, speaking: false };
  let petting = false;
  let panelHover = false;
  let idleTimer = 0;
  let loadTimer = 0;
  let poseTimer = 0;
  let expressionTimer = 0;
  let reaction: 'smug' | 'doubtful' | null = null;
  let acknowledged = false;
  root.dataset.stage = root.dataset.pose === 'out' ? 'open' : 'peek';
  const duration = (ms: number) =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains('motion-off')
      ? 0
      : ms;

  function syncVisibility() {
    root.dataset.sleeping = String(document.hidden);
  }
  syncVisibility();
  document.addEventListener('visibilitychange', syncVisibility, options);
  window.addEventListener('resize', () => positionDock(root), { ...options, passive: true });

  function expression() {
    root.dataset.expression = state.busy
      ? state.speaking
        ? 'talking'
        : 'thinking'
      : petting
        ? 'happy'
        : (reaction ?? 'curious');
  }
  function resetIdle() {
    clearTimeout(idleTimer);
    if (root.dataset.pose !== 'out') return;
    idleTimer = window.setTimeout(() => {
      const selection = window.getSelection();
      const log = root.querySelector<HTMLElement>('.lingyue-conversation');
      const reading = Boolean(
        (selection?.toString() && root.contains(selection.anchorNode)) ||
          log?.contains(document.activeElement) ||
          (log && log.scrollHeight - log.clientHeight - log.scrollTop > 48),
      );
      if (state.busy || state.hasDraft || panelHover || petting || reading || document.hidden) {
        resetIdle();
        return;
      }
      requestClose();
    }, RETRACT_AFTER_MS);
  }
  function retract() {
    clearTimeout(idleTimer);
    clearTimeout(loadTimer);
    clearTimeout(expressionTimer);
    clearTimeout(poseTimer);
    const returnFocus = root.querySelector('#lingyue-dialog')?.contains(document.activeElement);
    reaction = null;
    petting = false;
    expression();
    root.dataset.pose = 'peek';
    root.dataset.stage = 'returning';
    launcher?.setAttribute('aria-expanded', 'false');
    delete document.documentElement.dataset.lingyueOpen;
    window.dispatchEvent(new Event('koharu:lingyue-retract'));
    if (returnFocus) launcher.focus({ preventScroll: true });
    poseTimer = window.setTimeout(() => {
      root.dataset.stage = 'peek';
    }, duration(420));
  }
  function requestClose() {
    if (root.dataset.stage === 'closing') return;
    clearTimeout(poseTimer);
    clearTimeout(idleTimer);
    if (root.dataset.pose !== 'out' || !duration(220)) {
      retract();
      return;
    }
    root.dataset.stage = 'closing';
    poseTimer = window.setTimeout(retract, duration(220));
  }
  function open() {
    if (root.dataset.stage === 'opening') return;
    clearTimeout(poseTimer);
    if (root.dataset.pose === 'out' && state.open) {
      root.dataset.stage = 'open';
      root.querySelector<HTMLTextAreaElement>('#lingyue-message')?.focus({ preventScroll: true });
      resetIdle();
      return;
    }
    root.dataset.stage = 'opening';
    document.documentElement.dataset.lingyueOpen = 'true';
    launcher.setAttribute('aria-expanded', 'true');
    poseTimer = window.setTimeout(reveal, duration(130));
  }
  function reveal() {
    root.dataset.pose = 'out';
    root.dataset.stage = 'settling';
    hint.textContent = '在这里陪你读博客喵~';
    document.documentElement.dataset.lingyueOpen = 'true';
    launcher.setAttribute('aria-expanded', 'true');
    window.dispatchEvent(new Event('koharu:lingyue-open'));
    poseTimer = window.setTimeout(() => {
      root.dataset.stage = 'open';
    }, duration(520));
    clearTimeout(loadTimer);
    if (!acknowledged) {
      loadTimer = window.setTimeout(() => {
        if (acknowledged) return;
        hint.textContent = '刚才没接上话，再点我一下喵~';
        root.dataset.loadFailed = 'true';
        retract();
      }, 12000);
    }
    resetIdle();
  }
  launcher.addEventListener('click', open, options);
  launcher.addEventListener(
    'pointerenter',
    () => {
      petting = true;
      delete root.dataset.loadFailed;
      hint.textContent = '发现你啦，要聊聊吗喵~';
      expression();
      resetIdle();
    },
    options,
  );
  launcher.addEventListener(
    'pointerleave',
    () => {
      petting = false;
      expression();
      resetIdle();
    },
    options,
  );
  launcher.addEventListener(
    'focus',
    () => {
      petting = true;
      expression();
    },
    options,
  );
  launcher.addEventListener(
    'blur',
    () => {
      petting = false;
      expression();
      resetIdle();
    },
    options,
  );
  root.addEventListener(
    'pointerover',
    (event) => {
      panelHover = Boolean((event.target as Element).closest('#lingyue-dialog'));
      resetIdle();
    },
    options,
  );
  root.addEventListener(
    'pointerleave',
    () => {
      panelHover = false;
      resetIdle();
    },
    options,
  );
  root.addEventListener('pointerdown', resetIdle, options);
  root.addEventListener('keydown', resetIdle, options);
  root.addEventListener('scroll', resetIdle, { ...options, capture: true, passive: true });
  window.addEventListener(
    'koharu:lingyue-state',
    (event) => {
      const next = (event as CustomEvent<ChatState>).detail;
      if (next.busy || !next.open || (state.busy && !next.busy) || next.outcome !== state.outcome) {
        clearTimeout(expressionTimer);
        reaction = null;
        if (next.open && !next.busy) {
          reaction = next.outcome === 'complete' ? 'smug' : next.outcome === 'error' ? 'doubtful' : null;
          if (reaction)
            expressionTimer = window.setTimeout(() => {
              reaction = null;
              expression();
            }, 5000);
        }
      }
      state = next;
      acknowledged = true;
      clearTimeout(loadTimer);
      delete root.dataset.loadFailed;
      // Pose changes belong to open/close transitions. The first hydration
      // effect can still report open=false while the requested panel mounts.
      expression();
      resetIdle();
    },
    options,
  );
  window.addEventListener('koharu:lingyue-close-request', requestClose, options);
  window.addEventListener('koharu:lingyue-closed', requestClose, options);
  window.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape' && root.dataset.stage === 'opening' && !document.querySelector('dialog:modal')) {
        event.preventDefault();
        requestClose();
      }
    },
    options,
  );
  window.addEventListener(
    'koharu:lingyue-ready',
    () => {
      if (document.documentElement.dataset.lingyueOpen === 'true') window.dispatchEvent(new Event('koharu:lingyue-open'));
    },
    options,
  );
  return () => {
    clearTimeout(idleTimer);
    clearTimeout(loadTimer);
    clearTimeout(expressionTimer);
    clearTimeout(poseTimer);
    listeners.abort();
  };
}

let activeRoot: HTMLElement | null = null;
let dispose = () => {};
export function initCompanion() {
  const root = document.querySelector<HTMLElement>('[data-lingyue-companion]');
  if (root) positionDock(root);
  // Astro persists the same node across page changes, including its pending timers.
  if (root === activeRoot) return;
  dispose();
  activeRoot = root;
  dispose = root ? attach(root) : () => {};
}
