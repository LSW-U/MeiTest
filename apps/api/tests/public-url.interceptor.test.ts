/**
 * PublicUrlInterceptor 单测（方案 B：后端响应时重写图片 URL）
 *
 * 覆盖：
 *   - resolveRewriteRule：未设置 / 等于 endpoint / 带尾斜杠 / 自定义 bucket
 *   - rewriteUrls：字符串命中/不命中、嵌套对象/数组、null、非字符串标量、循环引用、不改原对象
 *   - 拦截器：开关关闭放行原引用；开启时 map 重写
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  PublicUrlInterceptor,
  resolveRewriteRule,
  rewriteUrls,
} from '../src/shared/storage/public-url.interceptor';

const ENV_BACKUP = { ...process.env };

function setEnv(env: Record<string, string | undefined>): void {
  process.env = { ...ENV_BACKUP, ...env };
}

describe('resolveRewriteRule', () => {
  beforeEach(() => {
    setEnv({
      OSS_ENDPOINT: 'http://localhost:9000',
      OSS_BUCKET: 'meimart',
      OSS_PUBLIC_HOST: undefined,
    });
  });
  afterEach(() => {
    process.env = ENV_BACKUP;
  });

  it('OSS_PUBLIC_HOST 未设置 → null（开关关闭）', () => {
    expect(resolveRewriteRule()).toBeNull();
  });

  it('OSS_PUBLIC_HOST 为空白字符串 → null', () => {
    expect(resolveRewriteRule({ OSS_PUBLIC_HOST: '   ' } as NodeJS.ProcessEnv)).toBeNull();
  });

  it('OSS_PUBLIC_HOST 等于 OSS_ENDPOINT → null（无需重写）', () => {
    expect(
      resolveRewriteRule({ OSS_ENDPOINT: 'http://localhost:9000', OSS_PUBLIC_HOST: 'http://localhost:9000' } as NodeJS.ProcessEnv),
    ).toBeNull();
  });

  it('等于 endpoint 但带尾斜杠 → 仍判相同 → null（防双斜杠语义）', () => {
    expect(
      resolveRewriteRule({ OSS_ENDPOINT: 'http://localhost:9000/', OSS_PUBLIC_HOST: 'http://localhost:9000' } as NodeJS.ProcessEnv),
    ).toBeNull();
  });

  it('设置不同公网地址 → 生成 from/to 前缀', () => {
    expect(
      resolveRewriteRule({ OSS_ENDPOINT: 'http://localhost:9000', OSS_BUCKET: 'meimart', OSS_PUBLIC_HOST: 'https://abc.trycloudflare.com' } as NodeJS.ProcessEnv),
    ).toEqual({
      from: 'http://localhost:9000/meimart/',
      to: 'https://abc.trycloudflare.com/meimart/',
    });
  });

  it('公网地址带尾斜杠 → 去尾（防双斜杠）', () => {
    expect(
      resolveRewriteRule({ OSS_ENDPOINT: 'http://localhost:9000/', OSS_PUBLIC_HOST: 'https://abc.trycloudflare.com/' } as NodeJS.ProcessEnv),
    ).toEqual({
      from: 'http://localhost:9000/meimart/',
      to: 'https://abc.trycloudflare.com/meimart/',
    });
  });

  it('自定义 bucket → 前缀含自定义 bucket', () => {
    expect(
      resolveRewriteRule({ OSS_ENDPOINT: 'http://minio:9000', OSS_BUCKET: 'prod-bucket', OSS_PUBLIC_HOST: 'https://cdn.example.com' } as NodeJS.ProcessEnv),
    ).toEqual({
      from: 'http://minio:9000/prod-bucket/',
      to: 'https://cdn.example.com/prod-bucket/',
    });
  });
});

describe('rewriteUrls', () => {
  const rule = { from: 'http://localhost:9000/meimart/', to: 'https://tunnel.example.com/meimart/' };

  it('命中前缀的字符串 → 替换', () => {
    expect(rewriteUrls('http://localhost:9000/meimart/products/main-1.jpg', rule)).toBe(
      'https://tunnel.example.com/meimart/products/main-1.jpg',
    );
  });

  it('仅前缀开头才替换：bucket 同名路径子串不误伤', () => {
    expect(rewriteUrls('https://evil.com/http://localhost:9000/meimart/x.jpg', rule)).toBe(
      'https://evil.com/http://localhost:9000/meimart/x.jpg',
    );
  });

  it('非本 bucket 地址 → 原样', () => {
    expect(rewriteUrls('http://localhost:9000/other-bucket/a.jpg', rule)).toBe(
      'http://localhost:9000/other-bucket/a.jpg',
    );
  });

  it('普通文本不受影响', () => {
    expect(rewriteUrls('商品描述，不含 URL', rule)).toBe('商品描述，不含 URL');
  });

  it('递归：嵌套对象 + 数组 + 多语言 JSON 字段', () => {
    const data = {
      mainImage: 'http://localhost:9000/meimart/products/a.jpg',
      images: ['http://localhost:9000/meimart/products/b.jpg', 'not-a-url'],
      nested: { deep: { avatar: 'http://localhost:9000/meimart/users/1/avatar.png' } },
      price: 199,
      name: { en: 'Apple', zh: '' },
    };
    expect(rewriteUrls(data, rule)).toEqual({
      mainImage: 'https://tunnel.example.com/meimart/products/a.jpg',
      images: ['https://tunnel.example.com/meimart/products/b.jpg', 'not-a-url'],
      nested: { deep: { avatar: 'https://tunnel.example.com/meimart/users/1/avatar.png' } },
      price: 199,
      name: { en: 'Apple', zh: '' },
    });
  });

  it('null / undefined / 数字 / 布尔 → 原样', () => {
    expect(rewriteUrls(null, rule)).toBeNull();
    expect(rewriteUrls(undefined, rule)).toBeUndefined();
    expect(rewriteUrls(42, rule)).toBe(42);
    expect(rewriteUrls(true, rule)).toBe(true);
  });

  it('循环引用 → 不死循环，按已处理返回', () => {
    const a: Record<string, unknown> = { url: 'http://localhost:9000/meimart/x.jpg' };
    a.self = a;
    const out = rewriteUrls(a, rule) as Record<string, unknown>;
    expect(out.url).toBe('https://tunnel.example.com/meimart/x.jpg');
    expect(out.self).toBe(a); // 循环点原样返回
  });

  it('不改原对象（返回浅拷贝）', () => {
    const data = { url: 'http://localhost:9000/meimart/x.jpg' };
    const out = rewriteUrls(data, rule) as Record<string, unknown>;
    expect(out.url).toBe('https://tunnel.example.com/meimart/x.jpg');
    expect(data.url).toBe('http://localhost:9000/meimart/x.jpg');
  });
});

describe('PublicUrlInterceptor', () => {
  const ENV_BACKUP2 = { ...process.env };

  afterEach(() => {
    process.env = ENV_BACKUP2;
  });

  it('开关关闭 → next.handle() 原样透传', async () => {
    delete process.env.OSS_PUBLIC_HOST;
    const interceptor = new PublicUrlInterceptor();
    const data = { url: 'http://localhost:9000/meimart/x.jpg' };
    const handle = vi.fn().mockReturnValue(
      (async function* () {}) as never, // 占位，实际用 Observable 替代见下
    );
    // 直接验证 intercept 分支：关闭时不订阅 map（用 of 的 Observable）
    const { of } = await import('rxjs');
    const handle2 = vi.fn(() => of(data));
    const result = await firstValue(interceptor.intercept({} as never, { handle: handle2 } as never));
    expect(result).toBe(data); // 同一引用 = 未重写
    expect(handle2).toHaveBeenCalled();
    void handle;
  });

  it('开关开启 → 响应被重写', async () => {
    process.env = {
      ...ENV_BACKUP2,
      OSS_ENDPOINT: 'http://localhost:9000',
      OSS_BUCKET: 'meimart',
      OSS_PUBLIC_HOST: 'https://tunnel.example.com',
    };
    const interceptor = new PublicUrlInterceptor();
    const { of } = await import('rxjs');
    const data = { url: 'http://localhost:9000/meimart/x.jpg', other: 'text' };
    const handle = vi.fn(() => of(data));
    const result = await firstValue(interceptor.intercept({} as never, { handle } as never));
    expect(result).toEqual({ url: 'https://tunnel.example.com/meimart/x.jpg', other: 'text' });
  });
});

/** 取 Observable 第一个值（拦截器响应映射的便捷断言） */
async function firstValue(obs: { forEach: (cb: (v: unknown) => void) => unknown }): Promise<unknown> {
  return new Promise((resolve) => {
    obs.forEach(resolve);
  });
}
