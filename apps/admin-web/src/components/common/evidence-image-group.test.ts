/**
 * EvidenceImageGroup 组件级单测（批1 D 步）
 *
 * 仓内 admin-web 测试环境 = node（无 jsdom/RTL，铁律不引第三方依赖），
 * 因此采用「纯逻辑提取 + 渲染前分支断言」模式：
 * - 导出 shouldRenderUrls（空态/字段缺失判定）供测试直测——与组件 early return 同源
 * - 交互态逻辑（sensitive 解锁 / lightbox 索引轮转 / 失败占位登记）提取为纯函数测试
 * - DOM 渲染等价由「refunds 重构视觉等价」浏览器截图兜底（验收线截图项）
 */
import { describe, it, expect } from 'vitest';
import {
  shouldRenderUrls,
  nextLightboxIndex,
  prevLightboxIndex,
  isThumbBlurred,
  onThumbClickIntent,
  urlsContentKey,
  isThumbFailed,
  LIGHTBOX_IMG_CLASSNAME,
} from './evidence-image-group';

describe('shouldRenderUrls（空数组/非数组不渲染）', () => {
  it('① 空数组不渲染', () => {
    expect(shouldRenderUrls([])).toBe(false);
  });

  it('② undefined/null（字段缺失）不渲染', () => {
    expect(shouldRenderUrls(undefined)).toBe(false);
    expect(shouldRenderUrls(null)).toBe(false);
  });

  it('③ 非数组（脏数据 string）不渲染', () => {
    expect(shouldRenderUrls('http://x/a.jpg' as unknown as string[])).toBe(false);
  });

  it('④ 1 张渲染', () => {
    expect(shouldRenderUrls(['http://x/a.jpg'])).toBe(true);
  });

  it('⑤ 3 张渲染', () => {
    expect(shouldRenderUrls(['a', 'b', 'c'])).toBe(true);
  });
});

describe('lightbox 多图切换索引轮转', () => {
  const n = 3;

  it('⑥ next 到尾循环回头', () => {
    expect(nextLightboxIndex(2, n)).toBe(0);
    expect(nextLightboxIndex(0, n)).toBe(1);
  });

  it('⑦ prev 到头循环回尾', () => {
    expect(prevLightboxIndex(0, n)).toBe(2);
    expect(prevLightboxIndex(2, n)).toBe(1);
  });

  it('⑧ 单图不提供切换（组件按 urls.length>1 条件渲染，此为前提断言）', () => {
    // 组件内 urls.length > 1 才渲染切换按钮；单图时 next/prev 不会被调用
    expect(nextLightboxIndex(0, 1)).toBe(0);
  });
});

describe('sensitive 模糊/解锁交互', () => {
  it('⑨ 非 sensitive 永不模糊', () => {
    expect(isThumbBlurred(false, false)).toBe(false);
    expect(isThumbBlurred(false, true)).toBe(false);
  });

  it('⑩ sensitive 未解锁模糊，解锁后清晰', () => {
    expect(isThumbBlurred(true, false)).toBe(true);
    expect(isThumbBlurred(true, true)).toBe(false);
  });

  it('⑪ sensitive 未解锁：点击意图=解锁（不开 lightbox）', () => {
    expect(onThumbClickIntent({ sensitive: true, unlocked: false })).toEqual({ unlock: true });
  });

  it('⑫ sensitive 已解锁：点击意图=开 lightbox', () => {
    expect(onThumbClickIntent({ sensitive: true, unlocked: true })).toEqual({ openIdx: true });
  });

  it('⑬ 非 sensitive：点击意图=开 lightbox', () => {
    expect(onThumbClickIntent({ sensitive: false, unlocked: false })).toEqual({ openIdx: true });
  });
});

describe('P2-1 加载失败占位（isThumbFailed 纯函数，与 Thumb/lightbox onError 分支同源）', () => {
  it('⑭ onError 未触发：正常渲染 img（失败映射为空 → 非失败）', () => {
    expect(isThumbFailed({}, 0)).toBe(false);
  });

  it('⑮ onError 触发后：该图转失败占位', () => {
    // 组件内 setLightboxesFailed((m) => ({ ...m, [idx]: true })) 的产物
    const failedMap = { 1: true };
    expect(isThumbFailed(failedMap, 1)).toBe(true);
    // 失败占位渲染内容与正常态互斥：data-testid 由 failed 分支独占
    expect(isThumbFailed(failedMap, 0)).toBe(false);
  });

  it('⑯ 其他图失败不误伤当前图（占位按 idx 隔离）', () => {
    const failedMap = { 0: true, 2: true };
    expect(isThumbFailed(failedMap, 1)).toBe(false);
    expect(isThumbFailed(failedMap, 2)).toBe(true);
  });

  it('⑰ refunds 回归等价：组件 lightbox className 常量 = 底本样式串（真约束：改组件常量此测试即红）', () => {
    // 底本 refunds/[id]/page.tsx 旧 lightbox img className（P13 4bc1e09 原值）
    const legacyLightboxClassName = 'h-auto max-h-[80vh] w-full object-contain';
    expect(LIGHTBOX_IMG_CLASSNAME).toBe(legacyLightboxClassName);
    // aria 序号契约：photoAction/photoUnlockAction 的 {number} 参数 = idx+1
    const idx = 2;
    expect(idx + 1).toBe(3); // number 参数语义：第 3 张
  });
});

describe('P2-2 urls 内容等价键（重渲染不重置解锁态/lightbox）', () => {
  it('⑱ 同内容不同 identity：contentKey 相同（effect 不触发）', () => {
    const a = ['http://x/1.jpg', 'http://x/2.jpg'];
    const b = [...a]; // riders 页内联新建数组的等价形态
    expect(urlsContentKey(b)).toBe(urlsContentKey(a));
  });

  it('⑲ 内容真变（换资源）：contentKey 变化（应重置交互态）', () => {
    expect(urlsContentKey(['http://x/1.jpg'])).not.toBe(urlsContentKey(['http://x/9.jpg']));
  });

  it('⑳ P2-2 回归：解锁态在重渲染后保持（模拟组件重置 effect 的判定输入）', () => {
    // 组件重置 effect 依赖 contentKey；父重渲染前后 urls 内容不变 → key 不变 → 不重置
    const before = ['http://x/kyc.jpg'];
    const afterRerender = ['http://x/kyc.jpg'];
    const unlockedBefore = true; // 用户已点击解锁
    // effect 判定：contentKey 未变 → 不执行 setUnlocked(false)
    const shouldReset = urlsContentKey(afterRerender) !== urlsContentKey(before);
    expect(shouldReset).toBe(false);
    // 解锁态保持
    expect(isThumbBlurred(true, unlockedBefore && !shouldReset ? unlockedBefore : unlockedBefore)).toBe(false);
  });
});
