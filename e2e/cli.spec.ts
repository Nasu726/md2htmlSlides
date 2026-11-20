import { build, buildSingle, check, checkExitCode, pdf, startDev, type DevServer } from '@mdhs/cli';
import { preparePrint } from '@mdhs/runtime';
import { expect, test } from '@playwright/test';
import {
  cpSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const fixtures = fileURLToPath(new URL('../fixtures/', import.meta.url));

test('mdhs build で書き出した HTML を file:// で開くと、素材付きで発表できる', async ({ page }) => {
  const out = test.info().outputPath('dist');
  const result = await build(join(fixtures, '02-tech-talk.md'), { outDir: out, measure: false });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(pathToFileURL(result.index).href);
  await expect(page.locator('.mds-slide.is-current')).toHaveAttribute('data-kind', 'title');
  // ロゴと背景の画像を、書き出し先のフォルダから読めている
  const logo = page.locator('.mds-logo');
  await expect
    .poll(() => logo.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  await page.keyboard.press('ArrowRight');
  const photo = page.locator('.mds-slide.is-current .mds-media img');
  await expect
    .poll(() => photo.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  expect(await page.evaluate(() => location.hash)).toBe('#/2');
});

test('mdhs build は計測して自動で分割し、fixtures の目安の枚数に収める', async () => {
  const cases: Array<[string, number, number]> = [
    ['01-plain-document', 12, 17],
    ['03-long-lecture', 30, 40],
    ['04-layouts', 20, 21],
    ['05-overrides', 15, 15],
  ];
  for (const [name, min, max] of cases) {
    const result = await build(join(fixtures, `${name}.md`), {
      outDir: test.info().outputPath(name),
    });
    expect(result.measureError).toBeUndefined();
    expect(result.slides, name).toBeGreaterThanOrEqual(min);
    expect(result.slides, name).toBeLessThanOrEqual(max);
    expect(
      result.diagnostics.filter((d) => d.code === 'slide/overflow'),
      name,
    ).toEqual([]);
  }
});

test('mdhs check：計測してあふれまで確かめ、書き出したものは残さない（#148）', async () => {
  // 11-edge-cases：書き間違いの警告が 7 つ。警告だけなので終了コードは 0、--strict なら 1
  const edge = await check(join(fixtures, '11-edge-cases.md'));
  expect(edge.measureError).toBeUndefined();
  expect(edge.counts).toMatchObject({ error: 0, warning: 7 });
  expect([checkExitCode(edge.counts, false), checkExitCode(edge.counts, true)]).toEqual([0, 1]);
  // 01-plain-document：縮小して収めたスライド（情報）だけなので、--strict でも 0
  const plain = await check(join(fixtures, '01-plain-document.md'));
  expect(plain.diagnostics.map((d) => d.code)).toContain('slide/shrunk');
  expect(plain.counts).toMatchObject({ error: 0, warning: 0 });
  expect(checkExitCode(plain.counts, true)).toBe(0);
  // 収まらないスライド（60% でも）は警告にする
  const root = mkdtempSync(join(tmpdir(), 'mdhs-check-'));
  const items = Array.from({ length: 40 }, (_, i) => `- 長めの説明が入った項目 ${i + 1}`).join(
    '\n',
  );
  writeFileSync(join(root, 'long.md'), `---\nsplit: manual\n---\n\n## 長いリスト\n\n${items}\n`);
  const long = await check(join(root, 'long.md'));
  expect(long.diagnostics.map((d) => d.code)).toContain('slide/overflow');
  expect(readdirSync(root)).toEqual(['long.md']);
});

/** フロントマターの theme を差し替える（なければ足す） */
function withTheme(source: string, theme: string): string {
  if (!source.startsWith('---\n')) return `---\ntheme: ${theme}\n---\n\n${source}`;
  const end = source.indexOf('\n---', 4);
  const front = source.slice(4, end);
  const replaced = /^theme:/m.test(front)
    ? front.replace(/^theme:.*$/m, `theme: ${theme}`)
    : `theme: ${theme}\n${front}`;
  return `---\n${replaced}${source.slice(end)}`;
}

test('どのテーマでも、計測して分割すればあふれない（#66・#93）', async () => {
  test.setTimeout(240_000);
  const root = mkdtempSync(join(tmpdir(), 'mds-theme-'));
  symlinkSync(join(fixtures, 'assets'), join(root, 'assets'));
  for (const theme of ['dark', 'bold', 'band', 'academic', 'pop']) {
    for (const name of ['01-plain-document', '04-layouts']) {
      const md = join(root, `${name}-${theme}.md`);
      writeFileSync(md, withTheme(readFileSync(join(fixtures, `${name}.md`), 'utf8'), theme));
      const result = await build(md, { outDir: join(root, `${name}-${theme}`) });
      const label = `${name}（${theme}）`;
      expect(result.measureError, label).toBeUndefined();
      const html = readFileSync(result.index, 'utf8');
      expect(html, label).toContain(`theme-${theme}`);
      // 明朝体は academic のときだけ埋め込む（#93）
      expect(html.includes("font-family:'MDS Noto Serif JP'"), label).toBe(theme === 'academic');
      expect(
        result.diagnostics.filter((d) => d.code === 'slide/overflow'),
        label,
      ).toEqual([]);
    }
  }
});

test('書き出した HTML は、使う文字だけに絞ったフォントを埋め込み、そのフォントで表示する（#67）', async ({
  page,
}) => {
  const out = mkdtempSync(join(tmpdir(), 'mds-fonts-'));
  const result = await build(join(fixtures, '02-tech-talk.md'), { outDir: out, measure: false });
  expect(result.fontBytes).toBeGreaterThan(50 * 1024);
  expect(result.fontBytes).toBeLessThan(400 * 1024);
  const html = readFileSync(result.index, 'utf8');
  expect(html).toContain("font-family:'MDS Noto Sans JP'");
  expect(html).toContain('data:font/woff2;base64,');
  expect(html).not.toContain('/__mds/fonts/');
  // 9枚目は日本語とコードがあるスライド
  await page.goto(`${pathToFileURL(result.index).href}#/9`);
  await page.evaluate(() => document.fonts.ready);
  const loaded = await page.evaluate(() =>
    [
      ...new Set([...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family)),
    ].sort(),
  );
  expect(loaded).toEqual(['MDS Inter', 'MDS JetBrains Mono', 'MDS Noto Sans JP']);
  const family = await page
    .locator('.mds-slide.is-current .mds-title')
    .evaluate((el) => getComputedStyle(el).fontFamily);
  expect(family).toMatch(/^"MDS Inter", "MDS Noto Sans JP"/);
});

test('mdhs build：動く構成図を配置して SVG にし、fixtures/README のレイアウトで説明を置く（13-arch。#107）', async ({
  page,
}) => {
  const out = mkdtempSync(join(tmpdir(), 'mds-arch-'));
  const result = await build(join(fixtures, '13-arch.md'), { outDir: out });
  expect(result.measureError).toBeUndefined();
  const html = readFileSync(result.index, 'utf8');
  // 書き出した HTML には SVG だけ（配置エンジンは入れない）
  expect(html).not.toContain('elkjs');
  await page.goto(pathToFileURL(result.index).href);
  const slides = page.locator('.mds-deck > .mds-slide');
  const info = await slides.evaluateAll((els) =>
    els.map((el) => ({
      title: el.querySelector('.mds-title')?.textContent ?? '',
      layout: /layout-(\w+)/.exec(el.className)?.[1],
      svgs: el.querySelectorAll('.mds-arch-svg').length,
      nodes: el.querySelectorAll('.mds-arch-svg .arch-node').length,
      captions: Array.from(el.querySelectorAll('.mds-arch-captions li'), (li) => li.textContent),
    })),
  );
  expect(info.slice(0, 6).map((s) => [s.layout, s.svgs, s.nodes, s.captions.length])).toEqual([
    ['stack', 1, 7, 4], // 横長なので説明は図の下
    ['stack', 1, 7, 4],
    ['stack', 1, 7, 4], // シナリオを省略：最初のシナリオ
    ['media', 1, 7, 0], // 動きのない構成図
    ['split', 1, 7, 4], // captions=side
    ['split', 1, 4, 3], // 上から下で縦長
  ]);
  expect(info[1]!.captions).toEqual([
    '注文を送る',
    '決済サービスが応答しない',
    '3回リトライして失敗する',
    '失敗を通知する',
  ]);
  // ノードの重なりがない（どの図でも）
  const overlaps = await page.locator('.mds-arch-svg').evaluateAll((svgs) =>
    svgs.map((svg) => {
      const boxes = Array.from(svg.querySelectorAll('.arch-node .shape'), (n) =>
        (n as SVGGraphicsElement).getBBox(),
      );
      let count = 0;
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i]!;
          const b = boxes[j]!;
          if (
            a.x < b.x + b.width &&
            b.x < a.x + a.width &&
            a.y < b.y + b.height &&
            b.y < a.y + a.height
          )
            count++;
        }
      return count;
    }),
  );
  expect(overlaps.every((n) => n === 0)).toBe(true);
});

test('mdhs build：動く構成図のシナリオを再生する。進むとパケットが動き、戻ると動かずに前の状態（13-arch。#108）', async ({
  page,
}) => {
  const out = mkdtempSync(join(tmpdir(), 'mds-arch-'));
  const result = await build(join(fixtures, '13-arch.md'), { outDir: out });
  expect(result.measureError).toBeUndefined();
  await page.setViewportSize({ width: 1280, height: 720 });
  const url = pathToFileURL(result.index).href;
  await page.goto(url);
  // fixtures/README のステップ数
  const steps = await page
    .locator('.mds-deck > .mds-slide')
    .evaluateAll((els) => els.slice(0, 7).map((el) => Number(el.dataset.steps ?? 0)));
  expect(steps).toEqual([4, 4, 4, 0, 4, 3, 6]);

  const slide = page.locator('.mds-slide.is-current');
  const state = () =>
    slide.evaluate((el) => ({
      marks: el.querySelectorAll('.arch-mark').length,
      badges: Array.from(
        el.querySelectorAll('.arch-badge'),
        (b) => `${b.textContent}${b.classList.contains('is-error') ? '!' : ''}`,
      ).sort(),
      active: Array.from(el.querySelectorAll('.arch-node.is-active'), (n) =>
        n.getAttribute('data-node'),
      ),
      current: el.querySelector('.mds-arch-captions .is-current')?.textContent ?? null,
      future: el.querySelectorAll('.mds-arch-captions .is-future').length,
      packets: el.querySelectorAll('.arch-packet').length,
    }));
  const jump = async (hash: string) => {
    await page.evaluate((h) => (location.hash = h), hash);
    await expect.poll(() => page.evaluate(() => location.hash)).toBe(hash);
  };

  // 正常時：最初は構成だけ（印・バッジ・強調なし、説明はすべて薄い）
  expect(await state()).toEqual({
    marks: 0,
    badges: [],
    active: [],
    current: null,
    future: 4,
    packets: 0,
  });
  // → でパケットが区間ごとに動き、終わると番号の印が残る
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await state()).packets).toBe(1);
  await expect.poll(async () => (await state()).marks, { timeout: 5000 }).toBe(2);
  expect(await state()).toMatchObject({
    active: ['user', 'web', 'api'],
    current: '注文を送る',
    future: 3,
    packets: 0,
  });
  // 2：コードの吹き出しを付けて動き、DB に「保存済み」のバッジ
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => slide.locator('.arch-packet .arch-bubble').count()).toBe(1);
  await expect.poll(async () => (await state()).badges).toEqual(['保存済み']);
  // 戻る：アニメーションせずに、すぐ前のステップの状態になる
  await page.keyboard.press('ArrowLeft');
  expect(await state()).toMatchObject({ marks: 2, badges: [], packets: 0, current: '注文を送る' });

  // 決済の障害：ステップ3で worker → pay が3回動き、2つの赤いバッジ
  await jump('#/2/2');
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => slide.locator('.arch-packet-label').first().textContent()).toBe('×3');
  await expect
    .poll(async () => (await state()).badges, { timeout: 8000 })
    .toEqual(['失敗!', '障害!']);
  // 同じ線を2回通っても、番号の印は重ならない
  const overlap = await slide.evaluate((el) => {
    const boxes = Array.from(el.querySelectorAll('.arch-mark'), (m) => m.getBoundingClientRect());
    return boxes.some((a, i) =>
      boxes
        .slice(i + 1)
        .some((b) => Math.abs(a.x - b.x) < a.width * 0.75 && Math.abs(a.y - b.y) < a.height * 0.75),
    );
  });
  expect(overlap).toBe(false);

  // コードブロックのシナリオ：キャッシュのバッジが「なし」→「あり」に変わる
  await jump('#/6/1');
  expect((await state()).badges).toEqual(['なし']);
  await jump('#/6/3');
  expect((await state()).badges).toEqual(['あり']);

  // 段階表示と組み合わせる：1 で図が出て（構成だけ）、2〜5 がシナリオの4ステップ、6 は最後の段落
  await jump('#/7/1');
  expect(await state()).toMatchObject({ marks: 0, badges: [], active: [] });
  await jump('#/7/5');
  expect((await state()).badges).toEqual(['失敗!', '障害!']);
  await jump('#/7/6');
  expect(await state()).toMatchObject({ badges: ['失敗!', '障害!'], packets: 0 });

  // 書き間違い：構成にない経路 b -> a は、そのステップのあいだ点線で仮に描く
  await jump('#/8/2');
  await expect(slide.locator('.arch-temp')).toHaveCount(1);

  // 発表者ビューの複製でも、バッジはノードの右上に付く（まだ描かれていない複製でも位置がずれない）
  await jump('#/1/2');
  const [presenter] = await Promise.all([page.waitForEvent('popup'), page.keyboard.press('p')]);
  const near = await presenter.locator('.mds-pv-current .mds-slide').evaluate((el) => {
    const badge = el.querySelector('.arch-badge')!.getBoundingClientRect();
    const db = el.querySelector('.arch-node[data-node="db"]')!.getBoundingClientRect();
    return Math.abs(badge.right - db.right) < 30 && Math.abs(badge.bottom - db.top) < 30;
  });
  expect(near).toBe(true);
});

test('動く構成図のカメラ：文字が 14px より小さい図だけ、ステップのノードへ寄り、ミニマップを出す（13-arch。#109）', async ({
  page,
}) => {
  const out = mkdtempSync(join(tmpdir(), 'mds-arch-'));
  const result = await build(join(fixtures, '13-arch.md'), { outDir: out });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.emulateMedia({ reducedMotion: 'reduce' }); // 動きなしで、すぐ寄った状態にする
  const url = pathToFileURL(result.index).href;
  const jump = async (hash: string) => {
    await page.evaluate((h) => (location.hash = h), hash);
    await expect.poll(() => page.evaluate(() => location.hash)).toBe(hash);
  };
  const camera = () =>
    page.locator('.mds-slide.is-current .mds-media-arch').evaluate((el) => {
      const svg = el.querySelector('svg.mds-arch-svg')!;
      const mini = el.querySelector('svg.arch-minimap');
      return {
        zoomed: el.classList.contains('is-zoomed'),
        full: svg.getAttribute('viewBox') === svg.getAttribute('data-arch-full'),
        label: Number((el as HTMLElement).dataset.archLabel),
        minimap: mini ? getComputedStyle(mini).display : 'none',
      };
    });
  // 説明を図の横に出す：全体では文字が小さい
  await page.goto(`${url}#/5`);
  const start = await camera();
  expect(start).toMatchObject({ zoomed: false, full: true, minimap: 'none' });
  expect(start.label).toBeLessThan(14);
  // 1：ユーザー → Web → API に寄り、ミニマップを出す
  await page.keyboard.press('ArrowRight');
  expect(await camera()).toMatchObject({ zoomed: true, full: false, minimap: 'block' });
  // 4：関係するノードが図の全体に広がるので、全体を見せる
  await jump('#/5/4');
  expect(await camera()).toMatchObject({ zoomed: false, full: true, minimap: 'none' });
  // 横長で文字が十分に大きい図（1枚目）は寄らない
  await jump('#/1/1');
  const wide = await camera();
  expect(wide).toMatchObject({ zoomed: false, full: true });
  expect(wide.label).toBeGreaterThanOrEqual(14);
});

test('mdhs build --single：素材のない別のフォルダで、ネットワークなしで開いて発表できる（02・09・13。#120）', async ({
  browser,
}) => {
  const dir = mkdtempSync(join(tmpdir(), 'mds-single-'));
  // ネットワークを遮断する（file: と data: だけ。YouTube などは数える）
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    reducedMotion: 'reduce',
  });
  const blocked: string[] = [];
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (/^(file|data|blob):/.test(url)) return route.continue();
    blocked.push(url);
    return route.abort();
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  const open = async (name: string) => {
    const result = await buildSingle(join(fixtures, `${name}.md`), {
      out: join(dir, `${name}.html`),
    });
    expect(result.measureError).toBeUndefined();
    // 書き出し先のフォルダには HTML だけ
    expect(readdirSync(dir).filter((f) => !f.endsWith('.html'))).toEqual([]);
    await page.goto(pathToFileURL(result.file).href);
    await page.evaluate(() => document.fonts.ready);
    return result;
  };
  const families = () =>
    page.evaluate(() => [
      ...new Set([...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family)),
    ]);

  // 02-tech-talk：画像・背景・ロゴ・同梱のフォント。枚数はフォルダの書き出しと同じ
  const talk = await open('02-tech-talk');
  const folder = await build(join(fixtures, '02-tech-talk.md'), {
    outDir: mkdtempSync(join(tmpdir(), 'mds-folder-')),
  });
  expect(talk.slides).toBe(folder.slides);
  expect(talk.embedded.map((e) => e.src).sort()).toEqual([
    'assets/bg-dark.jpg',
    'assets/cover.jpg',
    'assets/logo.svg',
    'assets/square.png',
  ]);
  const images = await page.locator('img').evaluateAll((imgs) =>
    imgs.map((img) => ({
      data: (img as HTMLImageElement).src.startsWith('data:'),
      loaded: (img as HTMLImageElement).naturalWidth > 0,
    })),
  );
  expect(images.length).toBeGreaterThan(0);
  expect(images.every((i) => i.data && i.loaded)).toBe(true);
  expect(await families()).toEqual(
    expect.arrayContaining(['MDS Inter', 'MDS Noto Sans JP', 'MDS JetBrains Mono']),
  );

  // 09-embeds：数式（KaTeX のフォント）と Mermaid の図
  await open('09-embeds');
  expect(await page.locator('.katex').count()).toBeGreaterThan(0);
  expect(await families()).toEqual(expect.arrayContaining(['KaTeX_Main']));
  expect(await page.locator('.mds-diagram svg').count()).toBe(6);

  // 13-arch：動く構成図を再生できる
  await open('13-arch');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.mds-slide.is-current .arch-mark')).toHaveCount(2);

  expect(errors).toEqual([]);
  expect(blocked).toEqual([]);
  await context.close();
});

test('動く構成図の PDF：既定はまとめの1枚（すべての番号・最後のバッジ・強調なし）、--steps はステップごと（13-arch。#109）', async ({
  page,
}) => {
  const out = mkdtempSync(join(tmpdir(), 'mds-pdf-'));
  const final = await pdf(join(fixtures, '13-arch.md'), { out: join(out, 'final.pdf') });
  expect(final.pages).toBe(13);
  // 13 枚 + ステップ（4・4・4・0・4・3・6・2・4・4・4・4・4）
  const steps = await pdf(join(fixtures, '13-arch.md'), {
    out: join(out, 'steps.pdf'),
    steps: true,
  });
  expect(steps.pages).toBe(60);
  // まとめの中身は、書き出した HTML で印刷の準備をして確かめる
  const result = await build(join(fixtures, '13-arch.md'), { outDir: join(out, 'html') });
  await page.goto(pathToFileURL(result.index).href);
  await page.evaluate(preparePrint, { steps: 'final' as const });
  const summary = await page.locator('.mds-deck > .mds-slide').evaluateAll((els) =>
    els.slice(0, 5).map((el) => ({
      marks: el.querySelectorAll('.arch-mark').length,
      badges: Array.from(el.querySelectorAll('.arch-badge'), (b) => b.textContent).sort(),
      dim: el.querySelectorAll('.is-dim').length,
      current: el.querySelectorAll('.mds-arch-captions .is-current, .is-future').length,
      zoomed: el.querySelectorAll('.is-zoomed').length,
    })),
  );
  expect(summary).toEqual([
    { marks: 9, badges: ['保存済み'], dim: 0, current: 0, zoomed: 0 }, // 正常時：2 + 1 + 3 + 3
    { marks: 8, badges: ['失敗', '障害'], dim: 0, current: 0, zoomed: 0 }, // 決済の障害：4 + 1 + 1 + 2
    { marks: 9, badges: ['保存済み'], dim: 0, current: 0, zoomed: 0 },
    { marks: 0, badges: [], dim: 0, current: 0, zoomed: 0 }, // 動きのない構成図
    { marks: 9, badges: ['保存済み'], dim: 0, current: 0, zoomed: 0 }, // カメラも使わない
  ]);
});

test('動く構成図の障害と回復：止める・届かない移動・切る・戻す。戻る操作とまとめでも同じ状態（13-arch。#180）', async ({
  page,
}) => {
  const out = mkdtempSync(join(tmpdir(), 'mds-arch-'));
  const result = await build(join(fixtures, '13-arch.md'), { outDir: out });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`${pathToFileURL(result.index).href}#/9`);
  const slide = page.locator('.mds-slide.is-current');
  const state = () =>
    slide.evaluate((el) => ({
      down: Array.from(el.querySelectorAll('.arch-node.is-down'), (n) =>
        n.getAttribute('data-node'),
      ),
      cut: Array.from(
        el.querySelectorAll('.arch-edge.is-cut'),
        (e) => `${e.getAttribute('data-from')}>${e.getAttribute('data-to')}`,
      ),
      cutMarks: el.querySelectorAll('.arch-state .arch-cross').length,
      failed: Array.from(el.querySelectorAll('.arch-fx > .arch-cross'), (c) => c.textContent),
      badges: Array.from(
        el.querySelectorAll('.arch-badge'),
        (b) => `${b.textContent}${b.classList.contains('is-error') ? '!' : ''}`,
      ).sort(),
    }));
  expect(await state()).toEqual({ down: [], cut: [], cutMarks: 0, failed: [], badges: [] });

  // 1：決済サービスを止める（灰色・赤い「停止」）
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await state()).down).toEqual(['pay']);
  expect((await state()).badges).toEqual(['停止!']);
  // 2：届かない移動を3回。パケットには回数、手前で × と「タイムアウト」
  await page.keyboard.press('ArrowRight');
  await expect
    .poll(() => slide.locator('.arch-packet-label').first().textContent())
    .toMatch(/^[123]\/3$/);
  await expect
    .poll(async () => (await state()).badges, { timeout: 8000 })
    .toEqual(['3回とも失敗!', '停止!']);
  expect((await state()).failed).toEqual(['タイムアウト']);
  // 3：つながりを切る（赤い破線と ×）。パケットは予備へ
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await state()).cut).toEqual(['worker>pay']);
  // 前のステップの × は、このステップを動かす前に消える
  expect(await state()).toMatchObject({ down: ['pay'], cutMarks: 1, failed: [] });
  // 戻る：動かさずに、前のステップの状態（切る前）
  await page.keyboard.press('ArrowLeft');
  expect(await state()).toMatchObject({ down: ['pay'], cut: [], cutMarks: 0 });
  // 4：復旧（元の色・緑の「復旧」）、つながりも戻る
  await page.evaluate(() => (location.hash = '#/9/4'));
  await expect.poll(async () => (await state()).down).toEqual([]);
  expect(await state()).toMatchObject({ cut: [], cutMarks: 0, badges: ['復旧'] });

  // まとめ（一覧・PDF）：最後の状態と、すべての届かない移動の ×
  await page.evaluate(preparePrint, { steps: 'final' as const });
  const summary = await page
    .locator('.mds-deck > .mds-slide')
    .nth(8)
    .evaluate((el) => ({
      down: el.querySelectorAll('.arch-node.is-down').length,
      cut: el.querySelectorAll('.arch-edge.is-cut').length,
      failed: Array.from(el.querySelectorAll('.arch-fx > .arch-cross'), (c) => c.textContent),
      badges: Array.from(el.querySelectorAll('.arch-badge'), (b) => b.textContent),
    }));
  expect(summary).toEqual({ down: 0, cut: 0, failed: ['タイムアウト'], badges: ['復旧'] });
});

test('動く構成図のノードの中身：表・上限・入らない中身・キーと値。戻る操作とまとめでも同じ（13-arch。#181）', async ({
  page,
}) => {
  const out = mkdtempSync(join(tmpdir(), 'mds-arch-'));
  const result = await build(join(fixtures, '13-arch.md'), { outDir: out });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`${pathToFileURL(result.index).href}#/10`);
  const slide = page.locator('.mds-slide.is-current');
  const queue = () =>
    slide.evaluate((el) => {
      const t = el.querySelector('.arch-table[data-for="queue"]');
      return {
        count: t?.querySelector('.arch-table-count')?.textContent ?? null,
        chips: Array.from(t?.querySelectorAll('.arch-chip text') ?? [], (c) => c.textContent),
        full: t?.classList.contains('is-full') ?? false,
        slots: t?.querySelectorAll('.arch-slot').length ?? 0,
      };
    });
  // 上限があるので、最初から空の枠5つ
  expect(await queue()).toEqual({ count: '0 / 5', chips: [], full: false, slots: 5 });
  // 表は配置で場所を取っている（ノードと重ならない）
  const overlap = await slide.evaluate((el) => {
    const box = el.querySelector('.arch-table-box')!.getBoundingClientRect();
    return Array.from(el.querySelectorAll('.arch-node .shape'), (n) =>
      n.getBoundingClientRect(),
    ).some(
      (b) => b.left < box.right && box.left < b.right && b.top < box.bottom && box.top < b.bottom,
    );
  });
  expect(overlap).toBe(false);
  await page.keyboard.press('ArrowRight');
  await expect
    .poll(async () => (await queue()).chips, { timeout: 6000 })
    .toEqual(['注文1', '注文2', '注文3']);
  expect((await queue()).count).toBe('3 / 5');
  await page.keyboard.press('ArrowRight');
  await expect
    .poll(async () => (await queue()).chips, { timeout: 6000 })
    .toEqual(['注文2', '注文3']);
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await queue()).full, { timeout: 6000 }).toBe(true);
  expect((await queue()).chips).toEqual(['注文2', '注文3', '注文4', '注文5', '注文6']);
  // 4：入らない中身は、赤い札と × で消える
  await page.keyboard.press('ArrowRight');
  await expect
    .poll(() => slide.locator('.arch-rejected .arch-chip text').allTextContents(), {
      timeout: 6000,
    })
    .toEqual(['注文7']);
  await expect(slide.locator('.arch-rejected')).toHaveCount(0, { timeout: 6000 });
  expect(await queue()).toMatchObject({ count: '5 / 5', full: true });
  // 戻る・番号で開く：動かさずに、その時点の中身
  await page.keyboard.press('ArrowLeft');
  expect((await queue()).chips).toHaveLength(5);
  await page.evaluate(() => (location.hash = '#/10/1'));
  await expect.poll(async () => (await queue()).chips).toEqual(['注文1', '注文2', '注文3']);

  // キーと値：2 で表が出て、4 で消える
  const cache = () =>
    slide.evaluate((el) =>
      Array.from(el.querySelectorAll('.arch-table[data-for="cache"] text'), (t) => t.textContent),
    );
  await page.evaluate(() => (location.hash = '#/11/2'));
  await expect.poll(cache).toEqual(['item:42', '本']);
  await page.evaluate(() => (location.hash = '#/11/4'));
  await expect.poll(cache).toEqual([]);

  // まとめ（一覧・PDF）：最後の中身
  await page.evaluate(preparePrint, { steps: 'final' as const });
  const summary = await page
    .locator('.mds-deck > .mds-slide')
    .evaluateAll((els) =>
      els
        .slice(9, 11)
        .map((el) =>
          Array.from(
            el.querySelectorAll('.arch-table .arch-chip text, .arch-table-key'),
            (t) => t.textContent,
          ),
        ),
    );
  expect(summary).toEqual([['注文2', '注文3', '注文4', '注文5', '注文6'], []]);
});

test('動く構成図の view=both・sequence：シーケンス図の矢印が、パケットと一緒に1本ずつ出る。まとめはすべて（13-arch。#182）', async ({
  page,
}) => {
  const out = mkdtempSync(join(tmpdir(), 'mds-arch-'));
  const result = await build(join(fixtures, '13-arch.md'), { outDir: out });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`${pathToFileURL(result.index).href}#/12`);
  const slide = page.locator('.mds-slide.is-current');
  const rows = () =>
    slide.evaluate((el) => ({
      shown: el.querySelectorAll('.seq-row:not(.is-future)').length,
      past: el.querySelectorAll('.seq-row.is-past').length,
      total: el.querySelectorAll('.seq-row').length,
      nodes: el.querySelectorAll('.arch-node').length,
    }));
  // 構成図（5 ノード）とシーケンス図（8 行）を1つの SVG に並べる。最初は矢印なし
  expect(await rows()).toEqual({ shown: 0, past: 0, total: 8, nodes: 5 });
  // 構成図が縦長なので、シーケンス図は右
  const right = await slide.evaluate((el) => {
    const seq = el.querySelector('.arch-seq')!.getBoundingClientRect();
    const nodes = Array.from(el.querySelectorAll('.arch-node'), (n) => n.getBoundingClientRect());
    return seq.left > Math.max(...nodes.map((n) => n.right));
  });
  expect(right).toBe(true);
  // →：パケットと同時にシーケンス図の点が動き、矢印が1本ずつ出る
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => slide.locator('.seq-dot').count()).toBe(1);
  await expect.poll(async () => (await rows()).shown, { timeout: 5000 }).toBe(2);
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await rows()).shown, { timeout: 5000 }).toBe(4);
  expect((await rows()).past).toBe(2);
  // 戻る：動かさずに、前のステップの行だけ
  await page.keyboard.press('ArrowLeft');
  expect(await rows()).toMatchObject({ shown: 2, past: 0 });
  await page.evaluate(() => (location.hash = '#/12/4'));
  await expect.poll(rows).toMatchObject({ shown: 8, past: 6 });

  // view=sequence：構成図は出さず、シーケンス図だけを進める
  await page.evaluate(() => (location.hash = '#/13'));
  await expect.poll(rows).toMatchObject({ shown: 0, nodes: 0 });
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await rows()).shown, { timeout: 6000 }).toBe(4);

  // まとめ（一覧・PDF）：すべての行を同じに見せる
  await page.evaluate(preparePrint, { steps: 'final' as const });
  const summary = await page
    .locator('.mds-deck > .mds-slide')
    .nth(11)
    .evaluate((el) => ({
      hidden: el.querySelectorAll('.seq-row.is-future, .seq-row.is-past').length,
      total: el.querySelectorAll('.seq-row').length,
    }));
  expect(summary).toEqual({ hidden: 0, total: 8 });
});

test('mdhs build：動く構成図の書き間違いを、行番号付きで警告する（13-arch。#106）', async () => {
  const out = mkdtempSync(join(tmpdir(), 'mds-arch-'));
  const result = await build(join(fixtures, '13-arch.md'), { outDir: out, measure: false });
  const lines = readFileSync(join(fixtures, '13-arch.md'), 'utf8').split('\n');
  const at = (text: string) => lines.findIndex((l) => l.includes(text)) + 1;
  const arch = result.diagnostics.filter((d) => d.code.startsWith('arch/'));
  expect(arch.map((d) => [d.code, d.line])).toEqual([
    ['arch/unknown-node', at('    a -> c')],
    ['arch/unknown-route', at('    b -> a')],
    ['arch/unknown-scenario', at('存在しないシナリオ')],
    ['arch/multiple', at('存在しないシナリオ')],
    ['arch/full', at('    queue += 注文7')],
  ]);
  // .arch のファイルは画像として扱わない（見つからない画像の警告を出さない）
  expect(result.diagnostics.filter((d) => d.code === 'media/not-found')).toEqual([]);
});

test('mdhs build は Mermaid を SVG にし、構文エラーは枠と行番号付きの警告にする（#71）', async () => {
  const out = mkdtempSync(join(tmpdir(), 'mds-mermaid-'));
  const result = await build(join(fixtures, '09-embeds.md'), { outDir: out });
  expect(result.measureError).toBeUndefined();
  const html = readFileSync(result.index, 'utf8');
  // フローチャート・シーケンス図・文章と並べる・ファイル参照・とても大きな図（Mermaid が5つ）と、
  // 小さな動く構成図（#107）
  expect(html.match(/<div class="mds-diagram has-ratio"/g)).toHaveLength(6);
  expect(html.match(/<svg[^>]*class="mds-arch-svg"/g)).toHaveLength(1);
  expect(html.match(/<div class="mds-diagram-error"/g)).toHaveLength(1);
  // 書き出した HTML には Mermaid を含めない（SVG だけ）。配色はテーマ（clean）のアクセント
  expect(html).not.toContain('mermaid.initialize');
  expect(html).toContain('#2563eb');
  const errors = result.diagnostics.filter((d) => d.code === 'diagram/mermaid-error');
  expect(errors.map((d) => d.line)).toEqual([50]);
});

test('mdhs build は数式を KaTeX で描き、使った書体と文字だけのフォントを埋め込む（#72）', async ({
  page,
}) => {
  const dir = mkdtempSync(join(tmpdir(), 'mds-math-'));
  const md = join(dir, 'math.md');
  writeFileSync(
    md,
    [
      '## 数式',
      '',
      '二次方程式 $ax^2 + bx + c = 0$ の解。価格は $10 から $20。',
      '',
      '$$',
      'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}',
      '$$',
      '',
      '## エラー',
      '',
      '閉じ忘れ $\\frac{1}{2$ です。',
      '',
    ].join('\n'),
  );
  const result = await build(md, { outDir: join(dir, 'dist') });
  const html = readFileSync(result.index, 'utf8');
  // 書き出した HTML には KaTeX の JS を含めない。CSS と、使った書体のフォントだけを入れる
  expect(html).not.toContain('renderToString');
  expect(html).toContain('<div class="mds-math-block"><span class="katex-display">');
  expect(html).toContain('@font-face{font-family:KaTeX_Main;font-style:normal;font-weight:400');
  expect(html).toContain('@font-face{font-family:KaTeX_Math;font-style:italic');
  expect(html).not.toContain('@font-face{font-family:KaTeX_Fraktur');
  // 金額は数式にしない
  expect(html).toContain('価格は $10 から $20。');
  expect(
    result.diagnostics.filter((d) => d.code === 'math/katex-error').map((d) => d.line),
  ).toEqual([11]);

  // 開くと、数式は KaTeX のフォントで描かれる
  await page.goto(pathToFileURL(result.index).href);
  await page.evaluate(() => document.fonts.ready);
  const loaded = await page.evaluate(
    () =>
      [...document.fonts].filter((f) => f.family === 'KaTeX_Main' && f.status === 'loaded').length,
  );
  expect(loaded).toBeGreaterThan(0);
  const error = page.locator('.mds-slide code.mds-math-error');
  await expect(error).toHaveText('$\\frac{1}{2$');
  await expect(error).toHaveAttribute('title', /expected '\}'/);
});

/** PDF のページの数（Chromium が書く PDF では、ページごとに /Type /Page がある） */
const pdfPages = (file: string) =>
  (readFileSync(file, 'latin1').match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length;

test('mdhs pdf：1スライド＝1ページ、--steps ではステップごとのページにする（#70）', async () => {
  const out = mkdtempSync(join(tmpdir(), 'mds-pdf-'));
  const final = await pdf(join(fixtures, '06-steps.md'), { out: join(out, 'final.pdf') });
  expect(final.error).toBeUndefined();
  expect(readFileSync(final.file, 'latin1').startsWith('%PDF-')).toBe(true);
  expect(readFileSync(final.file, 'latin1')).toContain('/Type /Font');
  expect(final.pages).toBe(13);
  expect(pdfPages(final.file)).toBe(13);
  const steps = await pdf(join(fixtures, '06-steps.md'), {
    out: join(out, 'steps.pdf'),
    steps: true,
  });
  // コードの行ハイライト（3段 → 2ステップ。#105）を含めて 38 ページ
  expect(steps.pages).toBe(38);
  expect(pdfPages(steps.file)).toBe(38);
});

test('フロントマターの pdf: { steps: each } でも、ステップごとのページにする（#70）', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mds-pdf-'));
  const body = '## A\n\n1つ目\n\n. . .\n\n2つ目\n\n. . .\n\n3つ目\n';
  writeFileSync(join(root, 'final.md'), body);
  writeFileSync(join(root, 'each.md'), `---\npdf:\n  steps: each\n---\n\n${body}`);
  const final = await pdf(join(root, 'final.md'), { out: join(root, 'final.pdf'), measure: false });
  const each = await pdf(join(root, 'each.md'), { out: join(root, 'each.pdf'), measure: false });
  expect([pdfPages(final.file), pdfPages(each.file)]).toEqual([1, 3]);
});

test.describe('mdhs dev', () => {
  let server: DevServer | undefined;
  test.afterEach(async () => {
    await server?.close();
  });

  test('ファイルを保存すると、プレビューが更新される', async ({ page }) => {
    const root = mkdtempSync(join(tmpdir(), 'mds-dev-'));
    cpSync(join(fixtures, '01-plain-document.md'), join(root, 'deck.md'));
    server = await startDev(join(root, 'deck.md'), { port: 0 });
    await page.goto(server.url);
    const second = page.locator('.mds-slide').nth(1).locator('.mds-title');
    const before = await second.textContent();
    const source = readFileSync(join(root, 'deck.md'), 'utf8');
    writeFileSync(join(root, 'deck.md'), source.replace(before!, '保存したら変わった見出し'));
    await expect(second).toHaveText('保存したら変わった見出し');
  });

  test('保存して発表の画面が読み込み直されても、発表者ビューをつなぎ直す（#59）', async ({
    page,
  }) => {
    const root = mkdtempSync(join(tmpdir(), 'mds-dev-'));
    cpSync(join(fixtures, '01-plain-document.md'), join(root, 'deck.md'));
    server = await startDev(join(root, 'deck.md'), { port: 0, measure: false });
    await page.goto(`${server.url}present#/2`);
    const [presenter] = await Promise.all([page.waitForEvent('popup'), page.keyboard.press('p')]);
    const pageText = presenter.locator('.mds-pv-page');
    await expect(pageText).toHaveText(/^2 \/ \d+$/);
    const total = Number((await pageText.textContent())!.split(' / ')[1]);
    const source = readFileSync(join(root, 'deck.md'), 'utf8');
    writeFileSync(join(root, 'deck.md'), `${source}\n\n## 足したスライド\n\n本文\n`);
    // 読み込み直した発表の画面が、同じ発表者ビューを書き直す
    await expect(pageText).toHaveText(`2 / ${total + 1}`);
    await page.keyboard.press('ArrowRight');
    await expect(pageText).toHaveText(`3 / ${total + 1}`);
    expect(presenter.isClosed()).toBe(false);
  });

  test('プレビューを印刷すると、隠したスライドを除いて1スライド＝1ページになる（#70）', async ({
    page,
  }) => {
    server = await startDev(join(fixtures, '05-overrides.md'), { port: 0, measure: false });
    await page.goto(server.url);
    await page.evaluate(() => document.fonts.ready);
    const [slides, hidden] = await page.evaluate(() => [
      document.querySelectorAll('.mds-slide').length,
      document.querySelectorAll('.mds-slide[data-hidden]').length,
    ]);
    expect(hidden).toBeGreaterThan(0);
    const file = join(mkdtempSync(join(tmpdir(), 'mds-print-')), 'preview.pdf');
    await page.pdf({ path: file, printBackground: true, preferCSSPageSize: true });
    expect(pdfPages(file)).toBe(slides! - hidden!);
  });

  test('同梱したフォントの分割ファイルを /__mds/fonts/ から配る（#67）', async ({
    page,
    request,
  }) => {
    server = await startDev(join(fixtures, '10-japanese.md'), { port: 0, measure: false });
    await page.goto(server.url);
    await page.evaluate(() => document.fonts.ready);
    const loaded = await page.evaluate(
      () => [...document.fonts].filter((f) => f.status === 'loaded').length,
    );
    expect(loaded).toBeGreaterThan(5);
    const url = /url\((\/__mds\/fonts\/[^)]+)\)/.exec(await page.content())![1]!;
    const response = await request.get(new URL(url, server.url).href);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toBe('font/woff2');
    const missing = await request.get(
      new URL('/__mds/fonts/@fontsource-variable/x.woff2', server.url).href,
    );
    expect(missing.status()).toBe(404);
    // 数式のフォント（#72）も同じ場所から配る
    const katex = await request.get(
      new URL('/__mds/fonts/katex/KaTeX_Main-Regular.woff2', server.url).href,
    );
    expect(katex.status()).toBe(200);
    expect(
      (await request.get(new URL('/__mds/fonts/katex/x.woff2', server.url).href)).status(),
    ).toBe(404);
  });

  test('プレビューは、スライド1枚がウィンドウに収まる大きさにする（#60）', async ({ page }) => {
    server = await startDev(join(fixtures, '01-plain-document.md'), { port: 0, measure: false });
    const first = page.locator('.mds-slide').first();
    // 半分の幅のウィンドウ：幅に合わせる
    await page.setViewportSize({ width: 960, height: 1000 });
    await page.goto(server.url);
    let box = (await first.boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(960 - 48 + 1);
    expect(box.width).toBeGreaterThan(960 - 48 - 30); // スクロールバーの分だけ狭くなる
    expect(box.height / box.width).toBeCloseTo(720 / 1280, 2);
    // 横長のウィンドウ：高さに合わせる
    await page.setViewportSize({ width: 1600, height: 600 });
    // 大きさを変えた後の合わせ直し（resize のイベント）を待つ。変える前の高さ（513px）は、
    // 「600 − 64 以下」をすでに満たすので、それでは待てない
    await expect
      .poll(async () => (await first.boundingBox())!.height)
      .toBeGreaterThan(600 - 64 - 2);
    box = (await first.boundingBox())!;
    expect(box.height).toBeLessThanOrEqual(600 - 64 + 1);
  });

  test('S で見えているスライドから発表を始め、Esc でプレビューの同じスライドに戻る（#60）', async ({
    page,
  }) => {
    server = await startDev(join(fixtures, '01-plain-document.md'), { port: 0, measure: false });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(server.url);
    await page
      .locator('.mds-slide')
      .nth(3)
      .evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await page.keyboard.press('s');
    await page.waitForURL(/\/present#\//);
    const player = () =>
      page.evaluate(() => (window as unknown as { mdsPlayer: { page: number } }).mdsPlayer.page);
    await expect.poll(player).toBe(4);
    await page.keyboard.press('ArrowRight');
    await expect.poll(player).toBe(5);
    // 発表者ビューを開いたまま終えると、発表者ビューも閉じる
    const [presenter] = await Promise.all([page.waitForEvent('popup'), page.keyboard.press('p')]);
    await expect(presenter.locator('.mds-pv-page')).toHaveText(/^5 \//);
    await page.keyboard.press('Escape');
    await page.waitForURL((url) => url.pathname === '/' && url.hash === '');
    await expect.poll(() => presenter.isClosed()).toBe(true);
    // プレビューでは、5枚目が画面の中央に見えている
    const box = (await page.locator('.mds-slide').nth(4).boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(-1);
    expect(box.y + box.height).toBeLessThanOrEqual(800 + 1);
  });

  test('書き出した HTML には戻る先がないので、Esc で発表は終わらない（#60）', async ({ page }) => {
    const out = mkdtempSync(join(tmpdir(), 'mds-build-'));
    await build(join(fixtures, '01-plain-document.md'), { outDir: out, measure: false });
    await page.goto(`${pathToFileURL(join(out, 'index.html')).href}#/2`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    expect(page.url()).toMatch(/index\.html#\/2$/);
  });
});
