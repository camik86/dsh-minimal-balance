# dsh-minimal-balance

在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）的 Web 侧边栏底部、**「设置」按钮正上方**显示 DeepSeek 账户余额。极简、只读、无遥测，API key 永远不下发浏览器。

> 社区插件，不是 DeepSeek 官方产品。

## 功能

- 侧边栏底部一行「余额 ¥xx.xx」，侧栏收起时也能在 56px 窄栏里显示
- **峰谷指示线**（金额下方 2px 短线）：
  - 蓝色 = 谷价，棕色 = 峰价，红色 = 欠费/不可用
  - 规则按北京时间：工作日 **09:00–12:00、14:00–18:00** 为峰时；**周末、中国法定节假日**全天谷价（2026 年节假日表内置，需每年更新）
- 余额低于阈值（CNY 2 / USD 1）时金额变暖色警示
- 刷新节奏：挂载时、每 60 秒、标签页重新可见时各一次；点击徽章可立即刷新
- 客户端只拿到一个金额；**API key 只存在 Host 进程**，永不下发浏览器
- 无第三方请求、无遥测

## 安装

```bash
# 插件管理器（推荐，npm 发布后）
plugin_manager install_bundle dsh-minimal-balance

# 直接从 GitHub（无需 npm）
plugin_manager install_bundle github:camik86/dsh-minimal-balance

# 或 CLI
dsh plugin --profile web add dsh-minimal-balance
```

安装后在 `dsh web` 侧边栏底部即可看到；改配置可能需要重启一次 `dsh web`。

### 配置 API key

插件通过 DSH 凭据服务解析 `DEEPSEEK_API_KEY`，逐次解析，改 key 不用重启。任选一种：

1. DSH 设置里把 `DEEPSEEK_API_KEY` 存进凭据（推荐）
2. 进程环境变量 `DEEPSEEK_API_KEY=sk-...`
3. `$DSH_HOME/.credentials.yaml` 里写 `DEEPSEEK_API_KEY: sk-...`

没有 key 时徽章显示 `--`。

## 配置项

在 profile 的 `cordis.patch.yml` 里覆盖 `dsh-minimal-balance` 这一行：

```yaml
- id: dsh-minimal-balance
  name: dsh-minimal-balance
  config:
    enabled: true                  # 总开关
    baseURL: https://api.deepseek.com
    apiKeyEnv: DEEPSEEK_API_KEY    # 凭据名 / 环境变量名
    cacheSeconds: 30               # 上游结果缓存秒数
    timeoutMs: 10000
    allowPublicClients: false      # 仅当 DSH 前有可信认证代理时才设为 true
```

## 安全模型

- 浏览器端只调用同源路由 `/dsh-minimal-balance`，拿到的是金额，不是 key
- 默认只允许**私有网段**客户端读取（loopback、10/8、172.16/12、192.168/16、link-local、IPv6 ULA、CGNAT/Tailscale 100.64/10）；公网地址返回 403
- 认证由 DSH 自身的连接校验 + 启动 token 负责，本插件不新增鉴权层
- 若通过受信反向代理对外暴露 DSH，再考虑 `allowPublicClients: true`

## 可选：局域网桥

如果上游路由只接受 loopback、而你在手机上看徽章，可加装 [`lan/`](lan/README.md)。主插件客户端会先试原生路径，失败自动回退到桥；装/卸桥都不需要改客户端。

## 目录

| 路径 | 作用 |
|---|---|
| `index.js` | Host 半：`/dsh-minimal-balance` 路由、凭据解析、上游请求与缓存 |
| `client.js` | Client 半：侧边栏 `sidebar.footer.action` 徽章、峰谷/低余额状态 |
| `cordis.patch.yml` | 插件行与默认配置 |
| `locale/*.json` | 插件显示名/描述 |
| `lan/` | 可选局域网桥（独立包 `dsh-minimal-balance-lan`） |

## License

MIT。

---

## English

A minimal community plugin for DeepSeek Harness: shows the DeepSeek account balance in the Web sidebar footer, right above **Settings**, with a colored peak/off-peak pricing indicator and a low-balance warning.

- The API key never leaves the host: the browser only receives the balance amount.
- Read access is limited to private-network clients by default (loopback, RFC1918, link-local, IPv6 ULA, Tailscale/CGNAT). Public clients get 403 unless `allowPublicClients: true` (only behind your own authenticated proxy).
- Peak pricing follows Beijing time: workdays 09:00–12:00 and 14:00–18:00 are peak; weekends and Chinese public holidays are off-peak (2026 holiday table bundled, update yearly).
- Install: `plugin_manager install_bundle dsh-minimal-balance`; configure `DEEPSEEK_API_KEY` through DSH credentials, the environment, or `$DSH_HOME/.credentials.yaml`.
- No telemetry, no third-party requests. MIT licensed.
