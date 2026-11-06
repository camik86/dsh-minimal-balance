/**
 * Client 半边：注册进 `sidebar.footer.action` —— 那个槽位正好渲染在「设置」的正上方。
 *
 * 槽位会传一个 `wide` 布尔值：
 *   wide === false  →  侧边栏收起（56px 窄栏，可用宽度约 36px）
 *   wide === true   →  侧边栏展开（约 280px）
 *
 * 余额下面那条短线表示当前计价时段：
 *   谷价 → 蓝   峰价 → 褐   欠费 → 红
 */
window.__ModuleLoader__.load({
  id: 'dsh-minimal-balance',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useRef, useCallback } = React;

    /**
     * Balance endpoint candidates, tried in order; the first one that answers
     * with `ok: true` is remembered for later polls.
     *
     * · `/dsh-minimal-balance` — the plugin's own host route (normal case).
     * · `/dsh-balance-lan`     — optional LAN bridge, see lan/README.md. It is
     *   only needed where the host route is reachable from loopback alone and
     *   the host module cannot be hot-reloaded.
     *
     * Trying the native route first keeps the extra hop out of the normal
     * case; the bridge remains a fallback for LAN clients.
     */
    const BASE_CANDIDATES = ['/dsh-minimal-balance', '/dsh-balance-lan'];
    let baseIndex = 0;

    /** 依次尝试候选地址，返回第一个 ok 的响应体。 */
    async function fetchBalance(fresh) {
      const query = fresh ? '?fresh=1' : '';
      let lastReason = 'unknown';
      for (let offset = 0; offset < BASE_CANDIDATES.length; offset += 1) {
        const index = (baseIndex + offset) % BASE_CANDIDATES.length;
        try {
          const response = await fetch(BASE_CANDIDATES[index] + query, { cache: 'no-store' });
          const payload = await response.json();
          if (payload && payload.ok) {
            baseIndex = index; // 记住这个地址，后面直接用，不再逐个试
            return payload;
          }
          lastReason = payload?.reason ?? 'unknown';
        } catch {
          lastReason = 'network';
        }
      }
      return { ok: false, reason: lastReason };
    }

    /**
     * 跟着「设置」按钮走：用同一个主题 token（--dsw-alias-label-primary）。
     * 深色主题下它就是 #F9FAFB，和设置按钮完全一致；浅色主题下会自动变深，
     * 不会像写死 #F9FAFB 那样在浅色侧边栏上变成看不见的白字。
     */
    const COLOR = 'var(--dsw-alias-label-primary, #F9FAFB)';

    /**
     * Collapsed sidebar rail is about 36px wide; 10px keeps "¥24.96" inside
     * it. Padding and letter-spacing are trimmed instead of shrinking the font
     * further.
     */
    const RAIL_FONT_SIZE = 10;
    const POLL_MS = 60000;

    /** 峰谷指示线：短、细、圆头。 */
    const LINE_WIDTH = 20;
    const LINE_HEIGHT = 2;
    const LINE_OFFPEAK = '#7AAAFF';  // 谷价
    const LINE_PEAK = '#C76B17';     // 峰价
    const LINE_ARREARS = '#C73202';  // 欠费

    /**
     * 低余额预警：金额跌到阈值以下就把**文字**变成暖色。
     * 线继续只表示计价时段 —— 两个信息各占一个通道，不互相打架。
     * 阈值按币种给，跟 DeepSeek 钱包的口径一致。
     */
    const LOW_BALANCE = { CNY: 2, USD: 1 };
    const LOW_BALANCE_FALLBACK = 10;
    const LOW_BALANCE_COLOR = '#FFB020';

    const PERIOD_TEXT = { peak: '峰价', offpeak: '谷价' };
    const REASON_TEXT = {
      weekend: '周末全天谷价',
      holiday: '法定节假日全天谷价',
      'peak-window': '高峰时段',
      'off-hours': '非高峰时段',
    };
    const REASON_TEXT_ERR = {
      'no-key': '没有找到 DEEPSEEK_API_KEY 凭据',
      'upstream-failed': '余额接口请求失败',
      network: '连不上本机插件路由',
      unknown: '暂时读不到余额',
    };

    // ------------------------------------------------------------ 峰谷时段
    /**
     * 余额接口不提供峰谷信息，只能自己按时间算。规则来源：
     *   2026-08-17 起：工作日高峰 = 北京时间 09:00–12:00、14:00–18:00，其余空闲
     *   2026-08-23 起：周六、周日全天按空闲（调休上班的周末也不例外）
     *   2026-09-19 起：中国法定节假日全天按空闲
     *
     * 判定顺序不能换：周末 / 节假日必须压过工作日窗口，
     * 否则国庆假期里的周四下午会被判成峰时。
     */
    const PEAK_WINDOWS = [[9 * 60, 12 * 60], [14 * 60, 18 * 60]];

    /**
     * 2026 年法定节假日（放假的那些天，北京日期）。
     * 来源：国务院办公厅关于 2026 年部分节假日安排的通知（2025-11-04）。
     * 只列"放假日"——调休上班的周六周日由"周末全谷"规则覆盖，不必列。
     */
    const HOLIDAYS = [
      '2026-01-01', '2026-01-02', '2026-01-03',                                  // 元旦
      '2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19',
      '2026-02-20', '2026-02-21', '2026-02-22', '2026-02-23',                    // 春节
      '2026-04-04', '2026-04-05', '2026-04-06',                                  // 清明
      '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05',      // 劳动
      '2026-06-19', '2026-06-20', '2026-06-21',                                  // 端午
      '2026-09-25', '2026-09-26', '2026-09-27',                                  // 中秋
      '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05',
      '2026-10-06', '2026-10-07',                                                // 国庆
    ];

    const WEEKDAY_INDEX = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

    /** 取某个时刻的北京时间（日期 / 当天第几分钟 / 星期）。 */
    function beijingNow(when) {
      const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short',
      });
      const bag = {};
      for (const part of formatter.formatToParts(when ?? new Date())) bag[part.type] = part.value;
      const hour = Number(bag.hour) % 24; // 某些 ICU 版本会把午夜给成 "24"
      return {
        date: bag.year + '-' + bag.month + '-' + bag.day,
        minutes: hour * 60 + Number(bag.minute),
        weekday: WEEKDAY_INDEX[bag.weekday] ?? 0,
      };
    }

    function computePeriod(when) {
      const { date, minutes, weekday } = beijingNow(when);
      if (weekday === 6 || weekday === 7) return { period: 'offpeak', reason: 'weekend' };
      if (HOLIDAYS.includes(date)) return { period: 'offpeak', reason: 'holiday' };
      for (const [start, end] of PEAK_WINDOWS) {
        if (minutes >= start && minutes < end) return { period: 'peak', reason: 'peak-window' };
      }
      return { period: 'offpeak', reason: 'off-hours' };
    }

    /** 每 30 秒重算：跨过 12:00 / 14:00 / 18:00 时线会自己变色，不用刷新。 */
    function usePeriod() {
      const [value, setValue] = useState(computePeriod);
      useEffect(() => {
        const timer = setInterval(() => {
          const next = computePeriod();
          setValue((prev) => (prev.period === next.period && prev.reason === next.reason ? prev : next));
        }, 30000);
        return () => clearInterval(timer);
      }, []);
      return value;
    }

    function formatMoney(currency, value) {
      if (!Number.isFinite(value)) return '--';
      const symbol = currency === 'CNY' ? '\u00A5' : currency === 'USD' ? '$' : '';
      return symbol ? symbol + value.toFixed(2) : value.toFixed(2) + ' ' + currency;
    }

    /** 欠费 = 账户不可用，或余额见底。 */
    function isArrears(data) {
      if (!data) return false;
      return data.available === false || !(data.total > 0);
    }

    /**
     * 余额读取：挂载时一次 + 每 60 秒一次 + 标签页重新可见时一次 + 手动刷新。
     *
     * 刻意不做"每轮对话结束立刻刷新"：DeepSeek 的余额结算滞后于轮次数十秒，
     * 轮次一结束就去查拿到的大概率还是旧值，反而让人以为没扣钱。
     * 60 秒的节奏越过这段结算窗口，看到的就是已经落账的数字。
     */
    function useBalance() {
      const [state, setState] = useState({ loading: true, data: null, reason: null });
      const inFlight = useRef(false);
      const mounted = useRef(true);

      const load = useCallback(async (fresh) => {
        if (inFlight.current) return; // 在途去重：点快了也只打一次上游
        inFlight.current = true;
        try {
          const payload = await fetchBalance(fresh);
          if (!mounted.current) return;
          setState({
            loading: false,
            data: payload && payload.ok ? payload : null,
            reason: payload && payload.ok ? null : (payload?.reason ?? 'unknown'),
          });
        } catch {
          if (mounted.current) setState({ loading: false, data: null, reason: 'network' });
        } finally {
          inFlight.current = false;
        }
      }, []);

      useEffect(() => {
        mounted.current = true;
        void load(false);
        const timer = setInterval(() => void load(false), POLL_MS);
        const onVisible = () => {
          if (document.visibilityState === 'visible') void load(false);
        };
        document.addEventListener('visibilitychange', onVisible);
        return () => {
          mounted.current = false;
          clearInterval(timer);
          document.removeEventListener('visibilitychange', onVisible);
        };
      }, [load]);

      return [state, load];
    }

    function BalanceBadge(props) {
      const wide = props.wide !== false;
      const [state, load] = useBalance();
      const [hover, setHover] = useState(false);
      const period = usePeriod();

      const data = state.data;
      const text = data ? formatMoney(data.currency, data.total) : '--';
      const arrears = isArrears(data);
      const low = !!data && !arrears
        && data.total < (LOW_BALANCE[data.currency] ?? LOW_BALANCE_FALLBACK);

      // 拿不到余额时不出线：失败就静默，别用颜色误导
      const showLine = data !== null;
      const color = arrears
        ? LINE_ARREARS
        : (period.period === 'peak' ? LINE_PEAK : LINE_OFFPEAK);
      // 线管"计价时段"，文字管"余额状态"
      const textColor = arrears ? LINE_ARREARS : (low ? LOW_BALANCE_COLOR : COLOR);

      const line = showLine
        ? h('span', {
          style: {
            display: 'block',
            width: LINE_WIDTH,
            height: LINE_HEIGHT,
            borderRadius: LINE_HEIGHT / 2,
            background: color,
            transition: 'background 200ms ease',
          },
        })
        : null;

      let title;
      if (data) {
        const periodLabel = arrears
          ? '\u6B20\u8D39'
          : (PERIOD_TEXT[period.period] ?? '\u2014') + '\uFF08' + (REASON_TEXT[period.reason] ?? '\u2014') + '\uFF09';
        const parts = [
          `\u4F59\u989D ${formatMoney(data.currency, data.total)}`,
          periodLabel,
        ];
        if (low) {
          parts.push('\u4F59\u989D\u504F\u4F4E\uFF08\u4F4E\u4E8E '
            + formatMoney(data.currency, LOW_BALANCE[data.currency] ?? LOW_BALANCE_FALLBACK) + '\uFF09');
        }
        parts.push(
          `\u8D60\u9001 ${formatMoney(data.currency, data.granted)}`,
          `\u5145\u503C ${formatMoney(data.currency, data.topped)}`,
          new Date(data.at).toLocaleTimeString(),
          '\u70B9\u51FB\u7ACB\u5373\u5237\u65B0',
        );
        title = parts.join(' \u00B7 ');
      } else {
        title = (REASON_TEXT_ERR[state.reason] ?? REASON_TEXT_ERR.unknown) + ' \u00B7 \u70B9\u51FB\u91CD\u8BD5';
      }

      const onActivate = () => void load(true);
      const onKey = (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onActivate();
        }
      };

      // ---- 收起：56px 窄栏里，金额在上、短线在下，都居中 ----
      if (!wide) {
        return h('div', {
          onClick: onActivate,
          onMouseEnter: () => setHover(true),
          onMouseLeave: () => setHover(false),
          title,
          role: 'button',
          tabIndex: 0,
          onKeyDown: onKey,
          style: {
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 3,
            maxWidth: '100%',
            // 不留左右内边距：窄栏只有约 36px，这 4px 是留给金额的
            padding: '3px 0',
            borderRadius: 6,
            cursor: 'pointer',
            color: COLOR,
            fontSize: RAIL_FONT_SIZE,
            lineHeight: 1.2,
            letterSpacing: '-0.4px',
            fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            background: hover ? 'var(--dsw-alias-bg-layer-2)' : 'transparent',
            transition: 'background 120ms ease',
            userSelect: 'none',
            WebkitUserSelect: 'none',
          },
        }, h('span', { style: { color: textColor } }, text), line);
      }

      // ---- 展开：和「设置」同款的一整行；左标签，右金额（金额下带短线） ----
      return h('div', {
        onClick: onActivate,
        onMouseEnter: () => setHover(true),
        onMouseLeave: () => setHover(false),
        title,
        role: 'button',
        tabIndex: 0,
        onKeyDown: onKey,
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          width: '100%',
          height: 32,
          padding: '0 8px',
          boxSizing: 'border-box',
          borderRadius: 8,
          cursor: 'pointer',
          color: COLOR,
          fontSize: 13,
          lineHeight: 1,
          background: hover ? 'var(--dsw-alias-bg-layer-2)' : 'transparent',
          transition: 'background 120ms ease',
          userSelect: 'none',
          WebkitUserSelect: 'none',
        },
      },
        h('span', null, '\u4F59\u989D'),
        h('span', {
          style: {
            display: 'flex',
            flexDirection: 'column',
            // center 而不是 flex-end：这一列的宽度由金额撑开，线比金额窄，
            // 用 flex-end 会让线贴着右边缘，看起来偏右 9px；center 才是"线在金额正下方居中"。
            alignItems: 'center',
            gap: 3,
          },
        },
          h('span', { style: { fontVariantNumeric: 'tabular-nums', color: textColor } }, text),
          line));
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action',
          id: 'sidebar-balance',
          order: 10,
        }, BalanceBadge));
      },
    };
  },
});
