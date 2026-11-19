import { FIT_MARGIN, fitSlides, measureJobs } from '@mdhs/core';
import { renderArch, renderMermaid } from '@mdhs/runtime';
import { frameHost, type FrameMode } from './frame-host.js';

/** iframe の中で frameHost を動かすスクリプト */
export function hostScript(mode: FrameMode): string {
  // fitSlides には、本文の下に残す余白（#92）を渡す
  const fit = `(root) => (${fitSlides.toString()})(root, ${FIT_MARGIN})`;
  return `(${frameHost.toString()})(${JSON.stringify(mode)}, ${measureJobs.toString()}, ${fit}, ${renderMermaid.toString()}, ${renderArch.toString()});`;
}

/** `</script>` を含んでも閉じないようにして、HTML の最後に入れる */
export const scriptTag = (source: string) =>
  `<script>${source.replace(/<\/(script)/gi, '<\\/$1')}</script>`;

type Reply = { id: number; type: string; [key: string]: unknown };

/**
 * 隔離した iframe（`sandbox="allow-scripts"`）とのやりとり（#73、設計プラン §9.4）。
 * 送ったメッセージに番号を付け、同じ番号の返事を待つ。
 */
export class Frame {
  readonly iframe: HTMLIFrameElement;
  private next = 1;
  private waiting = new Map<number, (reply: Reply) => void>();
  private destroyed = false;
  private readyResolve!: () => void;
  ready: Promise<void>;
  /** 返事ではないメッセージ（プレビューで S を押したなど） */
  onEvent?: (message: Reply) => void;

  constructor(
    readonly mode: FrameMode,
    parent: HTMLElement,
    options: { sandbox?: string; allow?: string; title: string; className?: string },
  ) {
    this.iframe = document.createElement('iframe');
    this.iframe.setAttribute('sandbox', options.sandbox ?? 'allow-scripts');
    if (options.allow) this.iframe.setAttribute('allow', options.allow);
    this.iframe.title = options.title;
    if (options.className) this.iframe.className = options.className;
    this.ready = new Promise((resolve) => (this.readyResolve = resolve));
    window.addEventListener('message', this.listen);
    parent.append(this.iframe);
  }

  /** 中身を入れ替える（ready を待ち直す） */
  load(html: string): Promise<void> {
    this.ready = new Promise((resolve) => (this.readyResolve = resolve));
    this.iframe.srcdoc = html;
    return this.ready;
  }

  private listen = (event: MessageEvent) => {
    if (event.source !== this.iframe.contentWindow) return;
    const message = event.data as Reply;
    if (message.type === 'ready') {
      this.readyResolve();
      return;
    }
    const resolve = this.waiting.get(message.id);
    if (resolve) {
      this.waiting.delete(message.id);
      resolve(message);
    } else {
      this.onEvent?.(message);
    }
  };

  /**
   * 送って、返事を待つ。iframe を消したあとは、すぐに `{ type: 'destroyed' }` を返す
   * （待ち続けて、次の描画が始まらなくなるのを防ぐ）
   */
  async request<T extends Reply = Reply>(message: object): Promise<T> {
    await this.ready;
    const id = this.next++;
    if (this.destroyed) return { id, type: 'destroyed' } as unknown as T;
    return new Promise<T>((resolve) => {
      this.waiting.set(id, resolve as (reply: Reply) => void);
      this.iframe.contentWindow?.postMessage({ ...message, id }, '*');
    });
  }

  destroy(): void {
    this.destroyed = true;
    window.removeEventListener('message', this.listen);
    this.iframe.remove();
    this.readyResolve();
    for (const [id, resolve] of this.waiting) resolve({ id, type: 'destroyed' });
    this.waiting.clear();
  }
}
