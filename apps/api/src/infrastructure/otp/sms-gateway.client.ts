/**
 * 通用 HTTP SMS 网关 client（批A R1 · 真实 SMS）
 *
 * 决策依据：批A-预研笔记-20260914.md ⑤步骤2 + 方案v2 §1 R1/R16
 *   - 网关选型未定（新② 账号 deadline 2026-09-16，$100）→ 抽象成可配置的
 *     通用 HTTP 网关：baseURL / auth header / 发码 payload 全部由 env 决定，
 *     选型落定后只填 env 不改代码（R16 留接口）。
 *   - 无 SDK，HTTP fetch 直调（范式参照 notify/push.strategy.ts:144-153）。
 *
 * env 键（真实凭据只进 GitHub Secret，R7，不落仓库）：
 *   - SMS_GATEWAY_URL              网关发码端点（POST）
 *   - SMS_GATEWAY_AUTH_HEADER      认证 header 名（默认 Authorization）
 *   - SMS_GATEWAY_AUTH_VALUE       认证 header 值（含 scheme，如 "Bearer xxx" 或 "AppKey xxx"）
 *   - SMS_GATEWAY_PAYLOAD_TEMPLATE 发码 payload JSON 模板，字符串值内支持
 *                                  {{phone}} / {{text}} 占位符，渲染时替换
 *                                  （JSON 解析后替换，值经 JSON.stringify 正确转义）
 *
 * 三者缺一即视为「网关未配置」，由调用方（sms.strategy）fail-fast 拒发 E-SMS-001。
 */
import { logger } from "../../shared/logger/logger";

/** 脱敏手机号（+670****78，N-2 第3项：日志不打明文 phone）
 * 定义在本文件（gateway client 是依赖链最底层，sms.strategy / notify 策略都复用，
 * re-export 保持原 import 路径不变；P3-1 修复时移入，避免 strategy↔client 循环 import） */
export function maskSmsPhone(phone: string): string {
  if (phone.length < 6) return '***';
  return phone.slice(0, 4) + '****' + phone.slice(-2);
}

/** 网关请求超时（ms）— 发码是同步链路，用户在等，不能无限挂 */
export const SMS_GATEWAY_TIMEOUT_MS = 10_000;

export interface SmsGatewayConfig {
  url: string;
  authHeader: string;
  authValue: string;
  /** JSON 模板字符串（已校验可解析），字符串值内 {{phone}}/{{text}} 占位 */
  payloadTemplate: string;
}

/**
 * 读取网关配置；三项必需 env 缺一或模板非法 → null（调用方 fail-fast 拒发）
 *
 * 每次调用现读（sendCode 频率受限流约束，无性能问题），测试切 env 无需缓存重置。
 */
export function readSmsGatewayConfig(): SmsGatewayConfig | null {
  const url = process.env.SMS_GATEWAY_URL;
  const authValue = process.env.SMS_GATEWAY_AUTH_VALUE;
  const payloadTemplate = process.env.SMS_GATEWAY_PAYLOAD_TEMPLATE;
  if (!url || !authValue || !payloadTemplate) return null;
  // 模板必须是合法 JSON 对象，否则选型填错时静默发不出码难排查 → 视为未配置
  try {
    const parsed: unknown = JSON.parse(payloadTemplate);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  } catch {
    return null;
  }
  return {
    url,
    authHeader: process.env.SMS_GATEWAY_AUTH_HEADER || 'Authorization',
    authValue,
    payloadTemplate,
  };
}

/** 网关发送失败（网络 / 非 2xx），message 带分类标签，不携带响应原文全文 */
export class SmsGatewayError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'SmsGatewayError';
    this.status = status;
  }
}

/** 递归渲染模板：字符串叶子里的 {{phone}}/{{text}} 替换为实际值 */
function renderTemplate(node: unknown, vars: { phone: string; text: string }): unknown {
  if (typeof node === 'string') {
    return node.replaceAll('{{phone}}', vars.phone).replaceAll('{{text}}', vars.text);
  }
  if (Array.isArray(node)) {
    return node.map((item) => renderTemplate(item, vars));
  }
  if (typeof node === 'object' && node !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      out[k] = renderTemplate(v, vars);
    }
    return out;
  }
  return node;
}

/**
 * 调网关发一条短信（HTTP POST，无 SDK）
 *
 * 成功 → 尽力解析 messageId（兼容 id / message_id / messageId 字段，缺省 undefined）
 * 失败 → 抛 SmsGatewayError（调用方决定 fail-fast 还是降级，本 client 不吞错）
 */
export async function sendSmsViaGateway(
  config: SmsGatewayConfig,
  phone: string,
  text: string,
): Promise<{ messageId?: string }> {
  let body: string;
  try {
    const template: unknown = JSON.parse(config.payloadTemplate);
    body = JSON.stringify(renderTemplate(template, { phone, text }));
  } catch (e) {
    // readSmsGatewayConfig 已校验过，这里兜底防御（模板在发送前被改坏等）
    throw new SmsGatewayError(`PAYLOAD_TEMPLATE_INVALID: ${(e as Error).message}`);
  }

  let response: Response;
  try {
    response = await fetch(config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [config.authHeader]: config.authValue,
      },
      body,
      signal: AbortSignal.timeout(SMS_GATEWAY_TIMEOUT_MS),
    });
  } catch (e) {
    throw new SmsGatewayError(`NETWORK_ERROR: ${(e as Error).message}`);
  }

  if (!response.ok) {
    const preview = await response.text().catch(() => '');
    // P3-1（审查修复，N-2 边角）：网关响应可能回显收件号，进日志前按 maskSmsPhone 口径脱敏
    const maskedPreview = preview
      .slice(0, 200)
      .replace(/\+?[0-9][0-9 ()\-]{5,18}[0-9]/g, (m) => maskSmsPhone(m.replace(/[^0-9+]/g, '')));
    logger.warn({
      msg: 'SMS_GATEWAY_HTTP_ERROR',
      status: response.status,
      bodyPreview: maskedPreview,
    });
    throw new SmsGatewayError(`GATEWAY_HTTP_${response.status}`, response.status);
  }

  // messageId 尽力解析：网关选型未定，兼容常见字段名；解析失败不影响发送成功语义
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  const rawId =
    payload && typeof payload === 'object'
      ? (payload.id ?? payload.message_id ?? payload.messageId ?? (payload.data as Record<string, unknown> | undefined)?.id)
      : undefined;
  return { messageId: typeof rawId === 'string' ? rawId : undefined };
}
