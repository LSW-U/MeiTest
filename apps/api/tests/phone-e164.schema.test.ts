/**
 * PhoneE164 契约 schema 归一化边界单测（批A R9，2026-09-15）
 *
 * controller 单测 mock 不经过 ZodValidationPipe（meimart-controller-zod-test-blindspot），
 * 拒绝/接受/变换路径直接 safeParse contract schema（geo.service.test.ts 先例）。
 *
 * 覆盖：空格/横线/括号清洗、00→+ 前缀、E.164 合法形态透传、非法格式拒、
 *       各 OTP 入口 schema（unified 两 + 旧 auth 四）归一化输出一致。
 */
import { describe, it, expect } from 'vitest';
import {
  normalizePhoneE164,
  PhoneE164,
  UnifiedSendSmsRequest,
  UnifiedVerifySmsRequest,
  LoginSmsRequest,
  SendSmsCodeRequest,
  RegisterRequest,
  PasswordResetRequest,
} from '@meimart/api-contract';

describe('normalizePhoneE164（纯函数）', () => {
  it.each([
    ['+670 7777 7777', '+67077777777'], // 空格
    ['+670-7777-7777', '+67077777777'], // 横线
    ['(+670) 7777 7777', '+67077777777'], // 括号
    ['0067077777777', '+67077777777'], // 00 国际前缀
    ['  +67077777777  ', '+67077777777'], // 首尾空白
    ['+67077777777', '+67077777777'], // 标准形态透传
  ])('normalizePhoneE164(%j) -> %j', (input, expected) => {
    expect(normalizePhoneE164(input)).toBe(expected);
  });

  it.each([
    ['12345'], // 太短，无国际前缀
    ['not-a-phone'],
    ['+0123'], // 国家码 0 非法
    ['+'],
    [''],
    [null],
    [undefined],
    [12345],
  ])('normalizePhoneE164(%j) -> undefined（schema 层拒收）', (input) => {
    expect(normalizePhoneE164(input)).toBeUndefined();
  });
});

describe('PhoneE164 schema（preprocess + regex）', () => {
  it('异形输入归一化输出 E.164 标准形态（parse 后 data 是清洗值）', () => {
    const r1 = PhoneE164.safeParse('+670 7777 7777');
    expect(r1.success).toBe(true);
    if (r1.success) expect(r1.data).toBe('+67077777777');

    const r2 = PhoneE164.safeParse('0067077777777');
    expect(r2.success).toBe(true);
    if (r2.success) expect(r2.data).toBe('+67077777777');
  });

  it('非法格式拒（400 E-COMMON-001 由 pipe 抛，schema 层 success=false）', () => {
    expect(PhoneE164.safeParse('12345').success).toBe(false);
    expect(PhoneE164.safeParse('abc').success).toBe(false);
    expect(PhoneE164.safeParse('').success).toBe(false);
    expect(PhoneE164.safeParse(null).success).toBe(false);
  });
});

describe('OTP 入口 schema 逐项（A5 入口清单：unified 两 + 旧 auth 四）', () => {
  it('UnifiedSendSmsRequest：空格 phone 归一化 + deviceId 保留', () => {
    const r = UnifiedSendSmsRequest.safeParse({ phone: '+670 7777 7777', deviceId: 'dev-1' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toEqual({ phone: '+67077777777', deviceId: 'dev-1' });
    expect(UnifiedSendSmsRequest.safeParse({ phone: '7777' }).success).toBe(false);
  });

  it('UnifiedVerifySmsRequest：phone 归一化，code/challengeId 校验不变', () => {
    const r = UnifiedVerifySmsRequest.safeParse({
      phone: '0067077777777', code: '123456', challengeId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.phone).toBe('+67077777777');
    expect(UnifiedVerifySmsRequest.safeParse({
      phone: '+67077777777', code: '12345', challengeId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    }).success).toBe(false); // code 必须 6 位
  });

  it('LoginSmsRequest：phone 归一化', () => {
    const r = LoginSmsRequest.safeParse({ phone: '+670 7777 7777', smsCode: '123456' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.phone).toBe('+67077777777');
  });

  it('SendSmsCodeRequest：phone 归一化 + scene default 保留', () => {
    const r = SendSmsCodeRequest.safeParse({ phone: '+670-7777-7777' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toEqual({ phone: '+67077777777', scene: 'LOGIN' });
  });

  it('RegisterRequest：phone 归一化 + password refine 保留', () => {
    const r = RegisterRequest.safeParse({ phone: '0067077777777', password: 'abcd1234' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.phone).toBe('+67077777777');
    // 弱密码仍拒（refine 未被 preprocess 破坏）
    expect(RegisterRequest.safeParse({ phone: '+67077777777', password: 'short' }).success).toBe(false);
  });

  it('PasswordResetRequest：phone 归一化 + 密码策略保留', () => {
    const r = PasswordResetRequest.safeParse({ phone: '+670 7777 7777', smsCode: '123456', newPassword: 'abcd1234' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.phone).toBe('+67077777777');
    expect(PasswordResetRequest.safeParse({ phone: '+67077777777', smsCode: '123456', newPassword: '11111111' }).success)
      .toBe(false); // 无字母拒
  });
});
