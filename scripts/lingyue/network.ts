import { execFileSync } from 'node:child_process';
import { fetch, ProxyAgent } from 'undici';

let dispatcher: ProxyAgent | undefined;
let initialized = false;
/** Public tokenizer files only. Honor the user's existing proxy; never log proxy credentials. */
export function fetchPublic(url: string) {
  if (!initialized) {
    initialized = true;
    let proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY;
    if (!proxy && process.platform === 'win32') {
      try {
        const configured = execFileSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-Command',
            "$p=Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'; if($p.ProxyEnable -eq 1){$p.ProxyServer}",
          ],
          { encoding: 'utf8', windowsHide: true },
        ).trim();
        const address =
          configured
            .split(';')
            .find((part) => part.startsWith('https='))
            ?.slice(6) ?? (!configured.includes('=') ? configured : '');
        if (address) proxy = address.includes('://') ? address : `http://${address}`;
      } catch {
        /* No system proxy; direct HTTPS remains available. */
      }
    }
    if (proxy) dispatcher = new ProxyAgent(proxy);
  }
  return fetch(url, { dispatcher, signal: AbortSignal.timeout(120000) });
}
export async function closePublicNetwork() {
  await dispatcher?.close();
}
