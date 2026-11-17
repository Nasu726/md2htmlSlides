import { describe, expect, it } from 'vitest';
import { cssPosition, formatAttrs, isPosition, parseAttrs } from './attrs.js';

describe('parseAttrs', () => {
  it('キー・値・クラス・ID を読む', () => {
    const result = parseAttrs('{layout=split .highlight #intro keep ratio=2:3}');
    expect(result).toEqual({
      ok: true,
      attrs: {
        values: { layout: 'split', keep: true, ratio: '2:3' },
        classes: ['highlight'],
        id: 'intro',
      },
      invalid: [],
    });
  });

  it('値は引用符で囲める', () => {
    const result = parseAttrs('{caption="2つの 案" lines=\'1|2-3\'}');
    expect(result.ok && result.attrs.values).toEqual({ caption: '2つの 案', lines: '1|2-3' });
  });

  it('値なし・値ありの両方を取るキー', () => {
    expect(parseAttrs('{bg}').ok).toBe(true);
    expect(parseAttrs('{bg=left dim=0.4}').ok).toBe(true);
    expect(parseAttrs('{step=2}').ok).toBe(true);
  });

  it('値が正しくないキーは除き、invalid に入れる', () => {
    const result = parseAttrs('{layout=columnz dim=2 step}');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.attrs.values).toEqual({ step: true });
    expect(result.invalid.map((i) => i.key)).toEqual(['layout', 'dim']);
  });

  it('未知のキーを含むなら属性ではない。似たキーがあれば候補を返す', () => {
    expect(parseAttrs('{lyout=split}')).toEqual({
      ok: false,
      typo: { key: 'lyout', suggestion: 'layout' },
    });
  });

  it('文中の {name} のような普通の文字列は、警告の対象にもしない', () => {
    expect(parseAttrs('{name}')).toEqual({ ok: false });
    expect(parseAttrs('{}')).toEqual({ ok: false });
  });

  it('= を含む未知のキーは書き間違いとして扱う', () => {
    expect(parseAttrs('{colour=red}')).toEqual({ ok: false, typo: { key: 'colour' } });
  });
});

describe('formatAttrs', () => {
  it('{…} の形に戻す', () => {
    const result = parseAttrs('{.a #b layout=split caption="x y" keep}');
    expect(result.ok && formatAttrs(result.attrs)).toBe('{#b .a layout=split caption="x y" keep}');
  });
});

describe('pos= と fill=（#64）', () => {
  it('pos= は1方向・2方向・割合を受け付け、CSS の位置に直す', () => {
    for (const value of ['top', 'center', 'bottom-right', '30%', '30% 20%', '12.5% 0%']) {
      expect(isPosition(value), value).toBe(true);
    }
    for (const value of ['middle', 'top-bottom', 'left-top', '30', '30% 20% 10%', 'top left']) {
      expect(isPosition(value), value).toBe(false);
    }
    expect(cssPosition('top')).toBe('top');
    expect(cssPosition('top-left')).toBe('top left');
    expect(cssPosition('30%   20%')).toBe('30% 20%');
  });

  it('正しくない pos= と fill= は除き、invalid に入れる', () => {
    const ok = parseAttrs('{bg pos="30% 20%" fill=blur}');
    expect(ok.ok && ok.attrs.values).toEqual({ bg: true, pos: '30% 20%', fill: 'blur' });
    const bad = parseAttrs('{bg pos=middle fill=white}');
    expect(bad.ok && bad.invalid.map((i) => i.key)).toEqual(['pos', 'fill']);
  });
});
