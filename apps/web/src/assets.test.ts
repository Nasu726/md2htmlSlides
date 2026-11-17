import { describe, expect, it } from 'vitest';
import { AssetStore, assetMark, fileListSource, normalizePath } from './assets.js';

describe('エディタの素材（#73）', () => {
  it('パスを、資料のフォルダからの相対パスにそろえる', () => {
    expect(normalizePath('./img/a.png')).toBe('img/a.png');
    expect(normalizePath('img/../a.png')).toBe('a.png');
    expect(normalizePath('img/%E5%86%99%E7%9C%9F.png?v=1#x')).toBe('img/写真.png');
  });

  it("印は、CSS の url('…') の中でも終わりがわかるように符号化する", () => {
    expect(assetMark("it's (1).png")).toBe('data:text/plain,mds-asset=it%27s%20%281%29.png');
  });

  it('一緒に選んだファイルを名前で探し、縦横を読む。ないものは見つからないとする', async () => {
    const png = Uint8Array.from(
      atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGNgYGD4zwAEAAYAAQB4dIyQAAAAAElFTkSuQmCC',
      ),
      (c) => c.charCodeAt(0),
    );
    const store = new AssetStore(fileListSource([new File([png], 'a.png')]));
    await store.ensure(['./assets/a.png', 'missing.png', 'https://example.com/x.png']);
    expect(store.probe('assets/a.png')).toEqual({ exists: true, width: 2, height: 1 });
    expect(store.probe('missing.png')).toEqual({ exists: false });
    expect(store.probe('https://example.com/x.png')).toBeUndefined();
    expect(store.url('./assets/a.png')).toBe('data:text/plain,mds-asset=assets%2Fa.png');
    expect(store.blobs().map(([key]) => key)).toEqual(['assets%2Fa.png']);
  });

  it('描くときに初めて使われた素材を覚えておく（読み込んでから描き直すため）', () => {
    const store = new AssetStore(fileListSource([]));
    store.url('logo.svg');
    expect(store.takeRequested()).toEqual(['logo.svg']);
    expect(store.takeRequested()).toEqual([]);
  });
});
