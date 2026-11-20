/**
 * エディタの画面の状態（#171 で app.tsx から分けた）。資料・表示・GitHub の状態を signal で持つ
 */
import { VERSION, type Diagnostic } from '@mdhs/core';
import { signal } from '@preact/signals';
import type { GitHubRepo } from './github.js';
import type { RenderResult } from './renderer.js';

/** 開いている資料。key は下書きを保存する名前 */
export interface DocInfo {
  kind: 'sample' | 'draft' | 'folder' | 'file' | 'url' | 'github';
  name: string;
  key: string;
  /** フォルダ・GitHub のリポジトリの中のパス */
  path?: string;
}

interface Folder {
  name: string;
  files: Map<string, FileSystemFileHandle>;
  documents: string[];
}

interface Notice {
  text: string;
  actions?: Array<{ label: string; run: () => void }>;
}

export const doc = signal<DocInfo>({ kind: 'sample', name: 'はじめに.md', key: 'sample' });
export const dirty = signal(false);
export const folder = signal<Folder | null>(null);
export const result = signal<RenderResult | null>(null);
export const notice = signal<Notice | null>(null);
export const showWarnings = signal(false);
export const dragging = signal(false);
/** 自動で区切られた位置のメニュー（#74） */
export const breakMenu = signal<{ line: number; x: number; y: number } | null>(null);
/** 早見表のパネル（#75）と、その検索の文字 */
export const cheatOpen = signal(false);
export const cheatQuery = signal('');

/**
 * 狭い画面（スマホ。#154）：エディタとプレビューを1つずつ表示し、上の「編集｜スライド」で切り替える。
 * 横向きのスマホ（高さが低い）も含める。styles.css の同じ条件の @media と合わせる
 */
const NARROW = '(max-width: 700px), (max-height: 500px)';
export const isNarrow = () => typeof matchMedia !== 'undefined' && matchMedia(NARROW).matches;
/** 版とビルド（#167）。どの版で開いているかが分かるように出す */
export const VERSION_LABEL = `v${VERSION}（${__BUILD__}）`;

/**
 * 新しい版が入った（Service Worker が入れ替わった）ことを知らせる（#167）。
 * アプリはキャッシュから開くので、公開した直後に開いた画面は古い版のまま
 */
export function showUpdateNotice(): void {
  notice.value = {
    text: '新しい版を読み込みました。再読み込みすると使えます（書いている内容は下書きに残ります）。',
    actions: [{ label: '再読み込み', run: () => location.reload() }],
  };
}

/** 狭い画面で表示している側 */
export const pane = signal<'edit' | 'preview'>('edit');
/** 狭い画面の「≡」のメニュー */
export const menuOpen = signal(false);
/** ソフトウェアキーボードが出ている（狭い画面では、下の状態の行を隠す） */
export const keyboard = signal(false);

/** GitHub（#147）：つないだリポジトリ、その画面、資料の一覧（読み込む前は null） */
export const github = signal<GitHubRepo | null>(null);
export const githubOpen = signal(false);
export const githubDocs = signal<string[] | null>(null);
export const githubBusy = signal(false);
export const githubError = signal('');

/** フォルダを開ける（File System Access API。Chrome・Edge） */
export const canOpenFolder = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

/** 警告の一覧に出すもの（情報は出さない） */
export const warningsOf = (r: RenderResult | null): Diagnostic[] =>
  r?.diagnostics.filter((d) => d.severity !== 'info') ?? [];
