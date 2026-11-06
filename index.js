/**
 * Host 半边：把 DeepSeek 的余额接口包成一个本机路由。
 *
 * 数据源（实测 186ms）：
 *   GET https://api.deepseek.com/user/balance   with  Authorization: Bearer <DEEPSEEK_API_KEY>
 *   → {"is_available":true,"balance_infos":[{"currency":"CNY","total_balance":"31.74",
 *      "granted_balance":"0.00","topped_up_balance":"31.74"}]}
 *
 * 这里刻意只做「取余额」这一件事。
 * 峰谷时段判定放在客户端：Host 模块改动需要重启才生效，而客户端是热更新的，
 * 所以时段规则（时段窗口、法定节假日）放客户端，改完立刻能看到，不用重启。
 *
 * 密钥只在本进程内使用，永不下发浏览器；浏览器只拿得到一个金额。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = '/dsh-minimal-balance';

const DEFAULTS = {
  enabled: true,
  /** Allow non-private clients to read the balance (only behind your own auth proxy). */
  allowPublicClients: false,
  baseURL: 'https://api.deepseek.com',
  /** 从哪个凭据名取 key（走 DSH 凭据服务，逐次解析，改 key 不用重启）。 */
  apiKeyEnv: 'DEEPSEEK_API_KEY',
  /** 上游结果的缓存秒数。 */
  cacheSeconds: 30,
  timeoutMs: 10000,
};

function respondJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(payload));
}

/**
 * Access policy.
 *
 * By default only private-network clients may read the balance: loopback,
 * 10/8, 172.16/12, 192.168/16, link-local, IPv6 ULA / link-local, and
 * CGNAT/Tailscale 100.64/10. Public addresses are rejected. This keeps the
 * badge usable from a phone on the same LAN without exposing the balance
 * interface to the internet.
 *
 * Authentication is owned by the harness itself (its connection fence and
 * launch token); this route adds no second auth layer. Set
 * `allowPublicClients: true` only when a trusted reverse proxy in front of
 * DSH performs the authentication.
 */
function isPrivateClient(req) {
  let a = req.socket?.remoteAddress ?? '';
  if (a.startsWith('::ffff:')) a = a.slice(7);            // IPv4-mapped IPv6
  if (a === '::1') return true;
  if (a.startsWith('127.')) return true;                  // 本机回环
  if (a.startsWith('10.')) return true;                   // 10/8
  if (a.startsWith('192.168.')) return true;              // 192.168/16
  if (a.startsWith('169.254.')) return true;              // link-local
  const m = /^172\.(\d{1,3})\./.exec(a);                  // 172.16–172.31
  if (m) { const n = Number(m[1]); if (n >= 16 && n <= 31) return true; }
  const t = /^100\.(\d{1,3})\./.exec(a);                  // Tailscale / CGNAT 100.64–100.127
  if (t) { const n = Number(t[1]); if (n >= 64 && n <= 127) return true; }
  if (/^f[cd][0-9a-f]{2}:/i.test(a)) return true;         // IPv6 ULA fc00::/7
  if (/^fe[89ab][0-9a-f]:/i.test(a)) return true;         // IPv6 link-local fe80::/10
  return false;
}

export const name = 'dsh-minimal-balance';
export const inject = ['webServer'];

export function apply(ctx, rawConfig) {
  const config = { ...DEFAULTS, ...(rawConfig ?? {}) };
  if (!config.enabled) return;

  let cache = { at: 0, payload: null };

  /**
   * 逐次解析密钥。凭据服务的约定是每次操作重新解析、不跨操作缓存，
   * 这样设置里换了 key，下一次刷新就生效，不用重启。
   */
  const resolveKey = async () => {
    try {
      const credentials = ctx.get('credentials');
      if (credentials && typeof credentials.resolve === 'function') {
        const resolved = await credentials.resolve(config.apiKeyEnv);
        if (resolved && typeof resolved.value === 'string' && resolved.value) return resolved.value;
      }
    } catch { /* 服务不可用就往下走 */ }

    const fromEnv = process.env[config.apiKeyEnv];
    if (fromEnv) return fromEnv;

    try {
      const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
      const text = fs.readFileSync(path.join(home, '.credentials.yaml'), 'utf8');
      const re = new RegExp('^\\s*' + config.apiKeyEnv + '\\s*:\\s*(\\S+)\\s*$', 'm');
      const matched = text.match(re);
      if (matched) return matched[1].replace(/^["']|["']$/g, '');
    } catch { /* 读不到就算了 */ }

    return null;
  };

  const fetchBalance = async () => {
    const key = await resolveKey();
    if (!key) return { ok: false, reason: 'no-key' };

    const upstream = await fetch(`${config.baseURL.replace(/\/+$/, '')}/user/balance`, {
      headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '');
      throw new Error(`上游 HTTP ${upstream.status}${detail ? ' ' + detail.slice(0, 120) : ''}`);
    }

    const json = await upstream.json();
    const info = Array.isArray(json?.balance_infos) ? json.balance_infos[0] : null;
    if (!info) throw new Error('返回体里没有 balance_infos');

    return {
      ok: true,
      available: json?.is_available === true,
      currency: info.currency ?? 'CNY',
      total: Number(info.total_balance ?? 0),
      granted: Number(info.granted_balance ?? 0),
      topped: Number(info.topped_up_balance ?? 0),
      at: Date.now(),
    };
  };

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: BASE,
    handler: async (req, res) => {
      if (config.allowPublicClients !== true && !isPrivateClient(req)) {
        respondJson(res, 403, { ok: false, reason: 'private-network-only' });
        return;
      }

      const fresh = new URL(req.url ?? '', 'http://localhost').searchParams.get('fresh') === '1';
      const now = Date.now();
      if (!fresh && cache.payload && now - cache.at < config.cacheSeconds * 1000) {
        respondJson(res, 200, cache.payload);
        return;
      }

      try {
        const payload = await fetchBalance();
        if (payload.ok) cache = { at: Date.now(), payload };
        // 一律 200：让前端只判断 payload.ok，不用处理异常分支
        respondJson(res, 200, payload);
      } catch (error) {
        respondJson(res, 200, {
          ok: false,
          reason: 'upstream-failed',
          detail: String(error?.message ?? error).slice(0, 200),
        });
      }
    },
  }));
}
