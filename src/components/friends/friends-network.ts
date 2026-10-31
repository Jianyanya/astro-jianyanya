import { layoutFriendNetwork } from '@lib/friend-network';
import { readMotionLevel, subscribeMotionLevel } from '@lib/motion-level';

let dispose: (() => void) | undefined;

function init() {
  dispose?.();
  const rootNode = document.querySelector<HTMLElement>('[data-friends-network]');
  const stageNode = rootNode?.querySelector<HTMLElement>('[data-network-stage]');
  const hubNode = rootNode?.querySelector<HTMLElement>('[data-network-hub]');
  if (!rootNode || !stageNode || !hubNode) return;
  const root: HTMLElement = rootNode;
  const stage: HTMLElement = stageNode;
  const hub: HTMLElement = hubNode;
  root.dataset.networkState = 'pending';
  const controller = new AbortController();
  const options = { signal: controller.signal };
  const nodes = [...stage.querySelectorAll<HTMLElement>('[data-network-node]')];
  const links = [...stage.querySelectorAll<SVGPathElement>('[data-network-link]')];
  const reveals = [...stage.querySelectorAll<SVGPathElement>('[data-network-reveal]')];
  const cards = [...stage.querySelectorAll<HTMLElement>('[data-network-card]')];
  const buttons = [...stage.querySelectorAll<HTMLButtonElement>('[data-network-select]')];
  let layout = layoutFriendNetwork(nodes.length, stage.clientWidth);
  let selected = -1;
  let pinned = false;
  let closeTimer = 0;
  let animations: Animation[] = [];
  let generation = 0;
  let started = false;
  const cardMotions = new Map<HTMLElement, Animation>();

  function showCard(card: HTMLElement, visible: boolean, immediate = false) {
    if (!immediate && card.dataset.visible === String(visible)) return;
    const wasHidden = card.hidden;
    const current = getComputedStyle(card);
    const from = { opacity: current.opacity, transform: current.transform };
    cardMotions.get(card)?.cancel();
    cardMotions.delete(card);
    card.dataset.visible = String(visible);
    card.inert = !visible;
    if (immediate || readMotionLevel() === 'reduced' || document.documentElement.classList.contains('motion-off')) {
      card.hidden = !visible;
      return;
    }
    if (wasHidden && !visible) return;
    card.hidden = false;
    const hidden = { opacity: '0', transform: 'translateY(10px) scale(.98)' };
    const motion = card.animate([wasHidden ? hidden : from, visible ? { opacity: '1', transform: 'none' } : hidden], {
      duration: visible ? 260 : 140,
      easing: 'cubic-bezier(.22,1,.36,1)',
      fill: 'forwards',
    });
    cardMotions.set(card, motion);
    void motion.finished.then(
      () => {
        if (cardMotions.get(card) !== motion) return;
        card.hidden = !visible;
        cardMotions.delete(card);
        motion.cancel();
      },
      () => {},
    );
  }

  function closeCard(immediate = false) {
    clearTimeout(closeTimer);
    selected = -1;
    pinned = false;
    cards.forEach((card) => {
      showCard(card, false, immediate);
    });
    buttons.forEach((button) => {
      button.setAttribute('aria-expanded', 'false');
    });
    links.forEach((link) => {
      delete link.dataset.active;
    });
  }
  function positionCard(index: number) {
    const node = layout.nodes[index];
    const card = cards[index];
    const left = node.x > layout.cx ? node.x - card.offsetWidth - 45 : node.x + 45;
    card.style.left = `${Math.max(12, Math.min(layout.width - card.offsetWidth - 12, left))}px`;
    card.style.top = `${Math.max(12, Math.min(layout.height - card.offsetHeight - 12, node.y - 70))}px`;
  }
  function openCard(index: number, pin = false) {
    if (root.dataset.networkState !== 'rest') return;
    if (selected === index) {
      clearTimeout(closeTimer);
      pinned ||= pin;
      return;
    }
    closeCard();
    selected = index;
    pinned = pin;
    showCard(cards[index], true);
    buttons[index].setAttribute('aria-expanded', 'true');
    links[index].dataset.active = 'true';
    positionCard(index);
  }
  function stop() {
    generation++;
    animations.forEach((animation) => {
      animation.cancel();
    });
    animations = [];
    root.dataset.networkState = 'rest';
  }
  function resize() {
    const width = stage.clientWidth;
    if (!width || (width === layout.width && stage.style.height === `${layout.height}px`)) return;
    if (started) stop();
    layout = layoutFriendNetwork(nodes.length, width);
    stage.style.height = `${layout.height}px`;
    stage.querySelector('svg')?.setAttribute('viewBox', `0 0 ${width} ${layout.height}`);
    nodes.forEach((node, index) => {
      const point = layout.nodes[index];
      node.style.setProperty('--node-x', `${point.x - layout.cx}px`);
      node.style.setProperty('--node-y', `${point.y - layout.cy}px`);
      links[index].setAttribute('d', `M ${layout.cx} ${layout.cy} L ${point.x} ${point.y}`);
      reveals[index].setAttribute('d', `M ${layout.cx} ${layout.cy} L ${point.x} ${point.y}`);
    });
    if (selected >= 0) positionCard(selected);
  }
  // Force the first layout update, including the SVG viewBox on narrow screens.
  layout.width = 0;
  resize();
  async function play() {
    closeCard(true);
    stop();
    started = true;
    if (readMotionLevel() === 'reduced' || document.documentElement.classList.contains('motion-off')) return;
    const run = generation;
    root.dataset.networkState = 'playing';
    animations.push(
      hub.animate(
        [
          { transform: 'scale(1)', filter: 'brightness(1)' },
          { transform: 'scale(.9)', filter: 'brightness(1.2)', offset: 0.4 },
          { transform: 'scale(1.06)', offset: 0.75 },
          { transform: 'scale(1)', filter: 'brightness(1)' },
        ],
        { duration: 620, easing: 'ease-in-out' },
      ),
    );
    nodes.forEach((node, index) => {
      const x = layout.nodes[index].x - layout.cx;
      const y = layout.nodes[index].y - layout.cy;
      animations.push(
        node.animate(
          [
            { transform: 'translate(0px, 0px) scale(.15)', opacity: 0 },
            { transform: `translate(${x * 1.08}px, ${y * 1.08}px) scale(1.06)`, opacity: 1, offset: 0.68 },
            { transform: `translate(${x * 0.98}px, ${y * 0.98}px) scale(.99)`, opacity: 1, offset: 0.86 },
            { transform: `translate(${x}px, ${y}px) scale(1)`, opacity: 1 },
          ],
          { delay: 340 + index * 80, duration: 760, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'backwards' },
        ),
      );
    });
    const landed = 340 + Math.max(0, nodes.length - 1) * 80 + 760;
    reveals.forEach((link, index) => {
      animations.push(
        link.animate([{ strokeDashoffset: '1' }, { strokeDashoffset: '0' }], {
          delay: landed + 60 + index * 80,
          duration: 440,
          easing: 'ease-out',
          fill: 'backwards',
        }),
      );
    });
    await Promise.allSettled(animations.map((animation) => animation.finished));
    if (!controller.signal.aborted && run === generation) {
      animations = [];
      root.dataset.networkState = 'rest';
    }
  }
  const viewport = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        viewport.disconnect();
        void play();
      }
    },
    { threshold: 0.25 },
  );
  viewport.observe(stage);
  const sizeObserver = new ResizeObserver(resize);
  sizeObserver.observe(stage);
  root.querySelector('[data-network-replay]')?.addEventListener(
    'click',
    () => {
      viewport.disconnect();
      void play();
    },
    options,
  );
  buttons.forEach((button, index) => {
    button.addEventListener(
      'pointerenter',
      (event) => {
        if (event.pointerType !== 'touch' && !pinned) openCard(index);
      },
      options,
    );
    button.addEventListener(
      'focus',
      () => {
        if (!pinned) openCard(index);
      },
      options,
    );
    button.addEventListener(
      'click',
      () => {
        if (selected === index && pinned) closeCard();
        else openCard(index, true);
      },
      options,
    );
  });
  root.addEventListener(
    'pointerover',
    (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('.friend-satellite, .friend-passport')) clearTimeout(closeTimer);
      else if (!pinned) {
        clearTimeout(closeTimer);
        closeTimer = window.setTimeout(closeCard, 180);
      }
    },
    options,
  );
  root.addEventListener(
    'pointerleave',
    () => {
      if (!pinned) closeTimer = window.setTimeout(closeCard, 180);
    },
    options,
  );
  root.addEventListener(
    'focusout',
    () => {
      queueMicrotask(() => {
        if (!root.contains(document.activeElement) || !document.activeElement?.closest('.friend-satellite, .friend-passport'))
          closeCard();
      });
    },
    options,
  );
  root.addEventListener(
    'keydown',
    (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (event.key === 'Tab' && !event.shiftKey && target?.closest('[data-network-select]') && selected >= 0) {
        event.preventDefault();
        cards[selected].querySelector('a')?.focus();
      }
      if (event.key === 'Escape' && selected >= 0) {
        const button = buttons[selected];
        button.focus({ preventScroll: true });
        closeCard();
      }
    },
    options,
  );
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (!(event.target instanceof Element) || !event.target.closest('.friend-satellite, .friend-passport')) closeCard();
    },
    options,
  );
  const filter = (id: string) => {
    closeCard();
    root.querySelectorAll<HTMLElement>('[data-network-filter]').forEach((tab) => {
      tab.setAttribute('aria-pressed', String(tab.dataset.networkFilter === id));
    });
    nodes.forEach((node, index) => {
      const hidden = id !== 'all' && node.dataset.group !== id;
      node.dataset.filtered = String(hidden);
      links[index].dataset.filtered = String(hidden);
      buttons[index].tabIndex = hidden ? -1 : 0;
    });
    const empty = root.querySelector<HTMLElement>('[data-network-empty]');
    if (empty) empty.hidden = nodes.some((node) => node.dataset.filtered !== 'true');
  };
  root.addEventListener(
    'click',
    (event) => {
      const tab = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-network-filter]') : null;
      if (tab?.dataset.networkFilter) filter(tab.dataset.networkFilter);
    },
    options,
  );
  const selectHash = () => {
    const id = location.hash.replace(/^#friends-/, '');
    const tab = [...root.querySelectorAll<HTMLElement>('[data-network-filter]')].find(
      (item) => item.dataset.networkFilter === id,
    );
    filter(tab ? id : 'all');
  };
  window.addEventListener('hashchange', selectHash, options);
  selectHash();
  const unwatchMotion = subscribeMotionLevel(() => {
    if (readMotionLevel() === 'reduced') {
      stop();
      cards.forEach((card, index) => {
        showCard(card, index === selected, true);
      });
    }
  });
  const sleep = () => {
    root.dataset.sleeping = String(document.hidden);
    animations.forEach((animation) => {
      if (document.hidden) animation.pause();
      else animation.play();
    });
  };
  document.addEventListener('visibilitychange', sleep, options);
  sleep();
  for (const image of root.querySelectorAll<HTMLImageElement>('[data-network-avatar]')) {
    if (!image.dataset.src) continue;
    image.src = image.dataset.src;
    void image
      .decode()
      .then(() => {
        if (!controller.signal.aborted) image.hidden = false;
      })
      .catch(() => {});
  }
  dispose = () => {
    controller.abort();
    stop();
    closeCard(true);
    viewport.disconnect();
    sizeObserver.disconnect();
    unwatchMotion();
  };
}

if (document.readyState !== 'loading') init();
else document.addEventListener('DOMContentLoaded', init, { once: true });
document.addEventListener('astro:page-load', init);
document.addEventListener('astro:before-swap', () => {
  dispose?.();
  dispose = undefined;
});
