/**
 * slide-form 纯函数单测（引导页内容可配置 · 批2）
 *
 * 纯函数测试（node 环境，不引 jsdom/RTL，对齐仓内
 * warehouse-operating-hours-card.test.ts 惯例）：表单校验 + 清洗转换。
 */
import { describe, it, expect } from 'vitest';
import { validateForm, toCreateInput, type SlideFormState } from './slide-form';

function form(overrides: Partial<SlideFormState> = {}): SlideFormState {
  return {
    icon: '',
    imageUrl: '',
    title: { en: 'Welcome' },
    description: {},
    sortOrder: '0',
    enabled: true,
    ...overrides,
  };
}

describe('validateForm', () => {
  it('① en title 存在 + sortOrder 合法 → null', () => {
    expect(validateForm(form())).toBeNull();
  });

  it('② en title 缺失 → titleEnRequired', () => {
    expect(validateForm(form({ title: { zh: '欢迎' } }))).toBe('titleEnRequired');
  });

  it('③ en title 纯空格 → titleEnRequired（trim）', () => {
    expect(validateForm(form({ title: { en: '   ' } }))).toBe('titleEnRequired');
  });

  it('④ sortOrder 非数字 → sortOrderInvalid', () => {
    expect(validateForm(form({ sortOrder: 'abc' }))).toBe('sortOrderInvalid');
  });

  it('⑤ sortOrder 负数 → sortOrderInvalid', () => {
    expect(validateForm(form({ sortOrder: '-1' }))).toBe('sortOrderInvalid');
  });

  it('⑥ sortOrder "0" 合法', () => {
    expect(validateForm(form({ sortOrder: '0' }))).toBeNull();
  });
});

describe('toCreateInput', () => {
  it('① 空字符串语言值不提交（tet 空 = 前端回退 en）', () => {
    const input = toCreateInput(form({ title: { en: 'Hi', tet: '' }, description: { en: 'x', pt: '' } }));
    expect(input.title).toEqual({ en: 'Hi' });
    expect(input.description).toEqual({ en: 'x' });
  });

  it('② 纯空格 icon/imageUrl → null', () => {
    const input = toCreateInput(form({ icon: '  ', imageUrl: '' }));
    expect(input.icon).toBeNull();
    expect(input.imageUrl).toBeNull();
  });

  it('③ icon/imageUrl 正常透传（trim 后）', () => {
    const input = toCreateInput(form({ icon: ' waving_hand ', imageUrl: 'https://x/y.png' }));
    expect(input.icon).toBe('waving_hand');
    expect(input.imageUrl).toBe('https://x/y.png');
  });

  it('④ sortOrder 解析为整数；空串回退 0', () => {
    expect(toCreateInput(form({ sortOrder: '12' })).sortOrder).toBe(12);
    expect(toCreateInput(form({ sortOrder: '' })).sortOrder).toBe(0);
  });

  it('⑤ enabled 透传', () => {
    expect(toCreateInput(form({ enabled: false })).enabled).toBe(false);
  });
});
