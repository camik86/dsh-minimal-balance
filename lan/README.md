# dsh-minimal-balance-lan (optional)

A tiny bridge for deployments where `dsh-minimal-balance` is configured to
accept **loopback clients only**, yet the badge is viewed from a phone or
tablet on the LAN.

It registers `/dsh-balance-lan` and forwards the request to
`/dsh-minimal-balance` over `127.0.0.1` on the same port that accepted the
connection (`req.socket.localPort` — no port configuration needed).

## Install

```bash
plugin_manager install_bundle ./lan        # from a local checkout
dsh plugin --profile web add ./lan         # or via the CLI
```

The main plugin's client tries `/dsh-minimal-balance` first and falls back to
this bridge automatically, so installing (or later removing) the bridge needs
no client change.

## When not to use it

- The balance route already allows private networks (the default).
- Your deployment is behind a reverse proxy that already forwards to the
  plugin route.

## Security

The bridge adds no new trust boundary: it forwards loopback→loopback and
inherits the upstream route's own access policy. Do not expose it to the
public internet.
