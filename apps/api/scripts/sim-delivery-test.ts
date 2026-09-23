/**
 * SIM 实测脚本（批A2-3 · 任务书#3 T4 · 一次性手动执行，不进 CI）
 *
 * 目的：向三家运营商（Timor Telecom / Telkomcel / Telemor）SIM 号码各发 20 条验证码
 * 短信，统计送达率（有运营商回执）+ 投递时延 P50/P95，作为 W6 切真前的通道验收依据。
 *
 * ── provider 无关 ──────────────────────────────────────────────
 * 输入任意适配器配置即可跑，复用 apps/api 现有 SMS 通道实现（与生产同代码路径）：
 *   1. stub      —— SMS_PROVIDER=stub（本机冒烟，不发真短信，回执恒缺）
 *   2. gateway   —— SMS_GATEWAY_URL / SMS_GATEWAY_AUTH_VALUE / SMS_GATEWAY_PAYLOAD_TEMPLATE
 *   3. tencent   —— TENCENT_SMS_SECRET_ID / TENCENT_SMS_SECRET_KEY / TENCENT_SMS_SDK_APP_ID
 *                   / TENCENT_SMS_TEMPLATE_ID（+ 可选 TENCENT_SMS_REGION/SIGN_NAME/SENDER_ID）
 * 凭据经 env 注入（与 .env / GitHub Secret 同源），脚本不落任何密钥。
 *
 * ── 运行方式 ──────────────────────────────────────────────────
 * 0. 前置：docker compose 起了 Redis（脚本直连 redis 读写验证码键）；
 *    准备三家 SIM 号码，每行一个 E.164（或可归一化形态），空行/井号注释分隔：
 *      # scripts/sim-numbers.txt 示例
 *      +6707xxxxxxx1   # Timor Telecom
 *      +6707xxxxxxx2   # Telkomcel
 *      +6707xxxxxxx3   # Telemor
 *
 * 1. 发送（默认每号 20 条，间隔 3s 防运营商频控）：
 *      cd apps/api
 *      SMS_PROVIDER=tencent \
 *      TENCENT_SMS_SECRET_ID=... TENCENT_SMS_SECRET_KEY=... \
 *      TENCENT_SMS_SDK_APP_ID=... TENCENT_SMS_TEMPLATE_ID=... \
 *      npx tsx scripts/sim-delivery-test.ts \
 *        --numbers scripts/sim-numbers.txt --count 20 --interval 3
 *
 * 2. 回执拉取（仅 tencent 通道；gateway/stub 无回执 API，送达率输出 N/A）：
 *      npx tsx scripts/sim-delivery-test.ts --pull
 *    脚本在发送阶段记录每次 send 的 SerialNo（scripts/tmp/sim-test-<ts>.json），
 *    --pull 按 SerialNo 调 SDK PullSmsSendStatus 匹配回执，输出：
 *      - 送达率 = ReportStatus=SUCCESS 条数 / 发送成功条数
 *      - 时延 P50/P95 = UserReceiveTime - sendAt（秒，仅统计有回执的）
 *
 * 3. 输出（终端 + scripts/tmp/sim-report-<ts>.md）：
 *      每号一行：sent / delivered / deliveryRate / P50 / P95，末尾汇总。
 *
 * ── 注意 ──────────────────────────────────────────────────────
 * - 真发会花钱：tencent/gateway 60 条真短信，跑前确认预算（首月 $500，见 sms-budget.ts）。
 * - 日预算熔断：stub/gateway 走 SmsStrategy.sendCode 与生产同路径，熔断天然生效；
 *   tencent 直调分支每次发送前调 assertSmsDailyBudget()（脚本为直调 SDK 抓 SerialNo，
 *   不经 sendCode，故须自检；每条真实短信计入当日预算，与生产同一熔断口径）。
 * - SerialNo→回执匹配依赖腾讯云回执保留窗口（控制台默认 7 天），建议发送后
 *   5-30 分钟内跑 --pull（运营商回执通常 1-5 分钟内到达）。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';

// ── env 装配：直接复用 apps/api 的策略栈（与生产同代码路径）──────────
process.env.DOTENV_CONFIG_QUIET = 'true';
// tsx 不自动加载 .env（apps/api 的 dev 由 nest/tsc 侧处理）——尽力补载一次
const envPath = path.resolve(__dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

const TMP_DIR = path.resolve(__dirname, 'tmp');
const DEFAULT_COUNT = 20;
const DEFAULT_INTERVAL_SECONDS = 3;
const PULL_REPORT_WINDOW_HOURS = 7; // 腾讯云回执保留窗口（超过则 SerialNo 可能拉不到）

interface SendRecord {
  phone: string;
  sentAt: number; // epoch ms
  ok: boolean;
  serialNo?: string;
  error?: string;
}

function parseArgs(): { mode: 'send' | 'pull'; numbersFile: string; count: number; interval: number } {
  const args = process.argv.slice(2);
  const mode = args.includes('--pull') ? 'pull' : 'send';
  const flag = (name: string, dflt: string): string => {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
  };
  return {
    mode,
    numbersFile: flag('--numbers', 'scripts/sim-numbers.txt'),
    count: Number(flag('--count', String(DEFAULT_COUNT))),
    interval: Number(flag('--interval', String(DEFAULT_INTERVAL_SECONDS))),
  };
}

/** 读号码文件：每行一个号码，# 注释与空行忽略；复用契约包同款归一化（00 前缀→+，去分隔符） */
function loadNumbers(file: string): string[] {
  const raw = readFileSync(path.resolve(file), 'utf-8');
  const out: string[] = [];
  for (const line of raw.split('\n')) {
    const cleaned = line.replace(/#.*$/, '').replace(/[\s\-().]/g, '');
    if (!cleaned) continue;
    const e164 = cleaned.startsWith('00') ? `+${cleaned.slice(2)}` : cleaned;
    if (!/^\+[1-9]\d{1,14}$/.test(e164)) {
      throw new Error(`非法号码（须可归一化为 E.164）：${line.trim()} → ${e164}`);
    }
    out.push(e164);
  }
  if (out.length === 0) throw new Error(`号码文件为空：${file}`);
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── 发送模式 ─────────────────────────────────────────────────────
async function runSend(numbersFile: string, count: number, interval: number): Promise<void> {
  const numbers = loadNumbers(numbersFile);
  const { SmsStrategy, clearSmsProviderCache } = await import('../src/infrastructure/otp/sms.strategy');
  clearSmsProviderCache(); // env 已就位，重置 provider 缓存确保按本次配置解析
  const strategy = new SmsStrategy();
  const provider = process.env.SMS_PROVIDER ?? (process.env.NODE_ENV === 'production' ? 'tencent' : 'stub');
  console.log(`[SIM-TEST] provider=${provider} 号码 ${numbers.length} 个 × 每号 ${count} 条，间隔 ${interval}s`);

  const records: SendRecord[] = [];
  // tencent 通道直调 SDK（捕获 SerialNo 用于 --pull 回执匹配——生产 SmsStrategy.sendCode
  // 只返回 expireIn，SerialNo 仅进日志不透出，脚本不改生产代码故在此自行调 API；
  // 发送参数/签名/键结构与 tencent-sms.strategy.ts 同款）。stub/gateway 走 SmsStrategy
  // （与生产同路径），无 SerialNo，送达率 N/A。
  const useTencentDirect =
    provider === 'tencent' && process.env.SMS_STUB_ALLOWED !== 'true';
  const tencentClient = useTencentDirect
    ? new (
        (await import('tencentcloud-sdk-nodejs-sms')) as typeof import('tencentcloud-sdk-nodejs-sms')
      ).sms.v20210111.Client({
        credential: {
          secretId: process.env.TENCENT_SMS_SECRET_ID!,
          secretKey: process.env.TENCENT_SMS_SECRET_KEY!,
        },
        region: process.env.TENCENT_SMS_REGION || 'ap-guangzhou',
      })
    : null;

  for (const phone of numbers) {
    for (let i = 0; i < count; i++) {
      const sentAt = Date.now();
      try {
        if (tencentClient) {
          // 直调腾讯云（SendSms 返回 SendStatusSet[0].SerialNo / Code）；code 键
          // otp:sms:LOGIN:{phone} 同款落 Redis（保持与 verifyCode 语义一致，脚本不 verify）。
          // P3-2：直调不经 sendCode，日预算熔断须自检——每条发送前过生产同款闸门。
          const { assertSmsDailyBudget } = await import('../src/infrastructure/otp/sms-budget');
          await assertSmsDailyBudget();
          const e164 = phone.startsWith('+') ? phone : `+${phone}`;
          const code = String(Math.floor(100000 + Math.random() * 900000));
          const resp = await tencentClient.SendSms({
            PhoneNumberSet: [e164],
            SmsSdkAppId: process.env.TENCENT_SMS_SDK_APP_ID!,
            TemplateId: process.env.TENCENT_SMS_TEMPLATE_ID!,
            TemplateParamSet: [code],
            ...(process.env.TENCENT_SMS_SIGN_NAME
              ? { SignName: process.env.TENCENT_SMS_SIGN_NAME }
              : {}),
            ...(process.env.TENCENT_SMS_SENDER_ID
              ? { SenderId: process.env.TENCENT_SMS_SENDER_ID }
              : {}),
          });
          const status = resp.SendStatusSet?.[0];
          if (!status || status.Code !== 'Ok') {
            throw new Error(`tencent send failed: ${status?.Code ?? 'NO_STATUS'}`);
          }
          // 与生产同款落 Redis（TTL 5min）——保证脚本行为对齐生产链路（可选校验用）
          const { redis } = await import('../src/shared/cache');
          await redis.set(`otp:sms:LOGIN:${e164}`, code, 'EX', 300);
          records.push({ phone, sentAt, ok: true, serialNo: status.SerialNo });
        } else {
          // scene=LOGIN 与生产 unified 入口一致；code 键 otp:sms:LOGIN:{phone} 会被
          // 后续发送覆盖（脚本不需要 verify，覆盖无影响；日志 [SMS_STUB]/[SMS_GATEWAY] 同款）
          await strategy.sendCode({ target: phone, scene: 'LOGIN' });
          records.push({ phone, sentAt, ok: true });
        }
      } catch (e) {
        records.push({ phone, sentAt, ok: false, error: (e as Error).message.slice(0, 120) });
        console.warn(`[SIM-TEST] 发送失败 ${phone} #${i + 1}: ${(e as Error).message}`);
      }
      if (i < count - 1) await sleep(interval * 1000);
    }
    console.log(`[SIM-TEST] ${phone} 完成 ${count} 条`);
  }

  mkdirSync(TMP_DIR, { recursive: true });
  const out = path.join(TMP_DIR, `sim-test-${Date.now()}.json`);
  writeFileSync(out, JSON.stringify({ provider, count, interval, records }, null, 2));
  const okCount = records.filter((r) => r.ok).length;
  console.log(`[SIM-TEST] 发送完成：${okCount}/${records.length} 成功；明细=${out}`);
  console.log('[SIM-TEST] 回执未拉取——稍后执行同脚本 --pull 统计送达率与时延（stub/gateway 无回执）');
}

// ── 回执拉取模式（tencent 专属）──────────────────────────────────
async function runPull(): Promise<void> {
  // --records <file> 指定明细；缺省自动取 scripts/tmp/ 下最新一份 sim-test-*.json
  const detailFiles: string[] = [];
  const recIdx = process.argv.indexOf('--records');
  if (recIdx >= 0 && process.argv[recIdx + 1]) {
    detailFiles.push(process.argv[recIdx + 1]);
  } else {
    // 自动取 scripts/tmp/ 下最新一份 sim-test-*.json
    if (!existsSync(TMP_DIR)) throw new Error(`无发送记录目录 ${TMP_DIR}，先跑发送模式`);
    const candidates = require('node:fs')
      .readdirSync(TMP_DIR)
      .filter((f: string) => f.startsWith('sim-test-') && f.endsWith('.json'))
      .sort();
    if (candidates.length === 0) throw new Error('无 sim-test-*.json 发送记录，先跑发送模式');
    detailFiles.push(path.join(TMP_DIR, candidates[candidates.length - 1]));
  }
  const detailFile = detailFiles[0];
  const { records } = JSON.parse(readFileSync(detailFile, 'utf-8')) as { records: SendRecord[] };
  const sent = records.filter((r) => r.ok && r.serialNo);
  // 兼容旧明细（无 SerialNo 字段）：sendCode 内部未透出 serialNo 时提示重发
  if (sent.length === 0) {
    throw new Error(
      '明细文件中没有带 SerialNo 的发送记录——请用本版脚本重跑发送模式' +
        '（旧版明细无法匹配腾讯云回执）',
    );
  }

  const tencent = await import('tencentcloud-sdk-nodejs-sms');
  const client = new tencent.sms.v20210111.Client({
    credential: {
      secretId: process.env.TENCENT_SMS_SECRET_ID!,
      secretKey: process.env.TENCENT_SMS_SECRET_KEY!,
    },
    region: process.env.TENCENT_SMS_REGION || 'ap-guangzhou',
  });

  // PullSmsSendStatus 是「按 SdkAppId 全局流式拉取」（最多 100 条/次），轮询到空或
  // 拉满为止，把回执按 SerialNo 建 map 再回填到我们的发送记录上
  const statusBySerial = new Map<string, { ReportStatus?: string; UserReceiveTime?: number }>();
  const sdkAppId = process.env.TENCENT_SMS_SDK_APP_ID!;
  for (let page = 0; page < 100; page++) {
    const resp = await client.PullSmsSendStatus({ Limit: 100, SmsSdkAppId: sdkAppId });
    const set = resp.PullSmsSendStatusSet ?? [];
    for (const s of set) {
      if (s.SerialNo) statusBySerial.set(s.SerialNo, s);
    }
    if (set.length < 100) break;
  }

  const cutoff = Date.now() - PULL_REPORT_WINDOW_HOURS * 3600 * 1000;
  const stale = records.some((r) => r.ok && r.sentAt < cutoff);
  if (stale) {
    console.warn(`[SIM-TEST] 警告：存在超过 ${PULL_REPORT_WINDOW_HOURS} 天的发送记录，回执可能已被腾讯云窗口淘汰`);
  }

  // 按号码聚合
  const byPhone = new Map<string, { sent: number; delivered: number; latencies: number[] }>();
  for (const r of records.filter((r) => r.ok)) {
    const agg = byPhone.get(r.phone) ?? { sent: 0, delivered: 0, latencies: [] };
    agg.sent++;
    const status = r.serialNo ? statusBySerial.get(r.serialNo) : undefined;
    if (status?.ReportStatus === 'SUCCESS' && status.UserReceiveTime) {
      agg.delivered++;
      agg.latencies.push(status.UserReceiveTime * 1000 - r.sentAt);
    }
    byPhone.set(r.phone, agg);
  }

  const pct = (arr: number[], p: number): string => {
    if (arr.length === 0) return 'N/A';
    const s = [...arr].sort((a, b) => a - b);
    const idx = Math.min(s.length - 1, Math.ceil(p * s.length) - 1);
    return `${Math.round(s[idx] / 100) / 10}s`;
  };

  const lines: string[] = [
    `# SIM 实测报告（${new Date().toISOString()}）`,
    '',
    `明细来源：${path.basename(detailFile)}`,
    '',
    '| 号码 | 发送成功 | 送达(回执SUCCESS) | 送达率 | P50 | P95 |',
    '|---|---|---|---|---|---|',
  ];
  let totalSent = 0;
  let totalDelivered = 0;
  const allLatencies: number[] = [];
  for (const [phone, agg] of byPhone) {
    totalSent += agg.sent;
    totalDelivered += agg.delivered;
    allLatencies.push(...agg.latencies);
    lines.push(
      `| ${phone} | ${agg.sent} | ${agg.delivered} | ` +
        `${((agg.delivered / agg.sent) * 100).toFixed(0)}% | ${pct(agg.latencies, 0.5)} | ${pct(agg.latencies, 0.95)} |`,
    );
  }
  lines.push(
    '',
    `**汇总**：发送成功 ${totalSent} 条，送达 ${totalDelivered} 条` +
      `（${totalSent ? ((totalDelivered / totalSent) * 100).toFixed(0) : 'N/A'}%），` +
      `全量 P50=${pct(allLatencies, 0.5)} / P95=${pct(allLatencies, 0.95)}`,
  );

  mkdirSync(TMP_DIR, { recursive: true });
  const report = path.join(TMP_DIR, `sim-report-${Date.now()}.md`);
  writeFileSync(report, lines.join('\n'));
  console.log(lines.join('\n'));
  console.log(`\n[SIM-TEST] 报告已写 ${report}`);
}

async function main(): Promise<void> {
  const { mode, numbersFile, count, interval } = parseArgs();
  if (mode === 'pull') {
    await runPull();
  } else {
    await runSend(numbersFile, count, interval);
  }
}

void main().catch((e) => {
  console.error('[SIM-TEST] 失败：', e.message);
  process.exit(1);
});
