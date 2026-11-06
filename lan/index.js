/**
 * Optional LAN bridge for dsh-minimal-balance.
 *
 * Why it exists: the balance route can be configured to allow only loopback
 * clients, while a phone or tablet on the same LAN reaches DSH through its LAN
 * address. In that setup the badge can only show `--`.
 *
 * What it does: registers /dsh-balance-lan and forwards the request to the
 * real balance route over 127.0.0.1 on the same port that accepted this
 * connection (taken from `req.socket.localPort`, so the DSH port never has to
 * be configured). The loopback hop satisfies a loopback-only upstream policy.
 *
 * Install it only when needed. If the upstream route already allows private
 * networks (the default of dsh-minimal-balance), this bridge is unnecessary.
 */
export const name = 'dsh-balance-lan';

export const inject = ['webServer'];

/** Path exposed by this bridge (the client calls this). */
const BASE = '/dsh-balance-lan';

/** The real balance route path. */
const UPSTREAM = '/dsh-minimal-balance';

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: BASE,
    handler: async (req, res) => {
      const port = req.socket?.localPort;
      if (!port) {
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ ok: false, reason: 'no-local-port' }));
        return;
      }

      const search = new URL(req.url ?? '', 'http://localhost').search;

      try {
        const upstream = await fetch(`http://127.0.0.1:${port}${UPSTREAM}${search}`, {
          headers: { accept: 'application/json' },
        });
        const body = await upstream.text();
        res.statusCode = upstream.status;
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.setHeader('cache-control', 'no-store');
        res.end(body);
      } catch (error) {
        res.statusCode = 502;
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({
          ok: false,
          reason: 'bridge-failed',
          message: String(error?.message ?? error),
        }));
      }
    },
  }));
}
