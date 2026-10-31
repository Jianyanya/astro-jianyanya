/** Decode every registered layer before revealing a complete pose. */
export function prepareCharacterArt(root: HTMLElement, signal: AbortSignal) {
  const prepare = async (art: SVGSVGElement) => {
    if (art.dataset.artReady === 'true' || art.dataset.artLoading === 'true') return;
    art.dataset.artLoading = 'true';
    const urls = [
      ...new Set(
        [...art.querySelectorAll('image')]
          .map((layer) => layer.getAttribute('href'))
          .filter((url): url is string => Boolean(url)),
      ),
    ];
    try {
      await Promise.all(
        urls.map(async (url) => {
          const image = new Image();
          image.src = url;
          await image.decode();
        }),
      );
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (!signal.aborted && art.isConnected) art.dataset.artReady = 'true';
    } catch {
      // Keep the usable text launcher; never expose a partially loaded face/body.
    } finally {
      delete art.dataset.artLoading;
    }
  };
  const prepareAll = () => {
    for (const art of root.querySelectorAll<SVGSVGElement>('.lingyue-character, .lingyue-perch')) void prepare(art);
  };
  prepareAll();
  window.addEventListener('online', prepareAll, { signal });
  root.querySelector('#lingyue-launcher')?.addEventListener('click', prepareAll, { signal });
}
