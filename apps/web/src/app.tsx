/**
 * Web エディタの画面（#73）。状態は state.ts、資料の処理は session.ts・files.ts・github-session.ts、
 * 画面の部品は ui/ にある（#171 で分けた）
 */
import { useEffect, useRef } from 'preact/hooks';
import { createEditor } from './editor.js';
import { assetCandidates, openFiles, save, start } from './files.js';
import { followVisualViewport } from './mobile.js';
import { present } from './present.js';
import { Renderer } from './renderer.js';
import { attach, jumpToSlide, onChange, onCursor, showSlide } from './session.js';
import { slideInfoAt } from './slide-gutter.js';
import {
  breakMenu,
  cheatOpen,
  dragging,
  folder,
  githubOpen,
  keyboard,
  pane,
  showWarnings,
} from './state.js';
import { BreakMenu } from './ui/BreakMenu.js';
import { CheatSheet, toggleCheatSheet } from './ui/CheatSheet.js';
import { FileList } from './ui/FileList.js';
import { GitHubDialog } from './ui/GitHubDialog.js';
import { Menu } from './ui/Menu.js';
import { NoticeBar } from './ui/NoticeBar.js';
import { StatusBar } from './ui/StatusBar.js';
import { Toolbar } from './ui/Toolbar.js';
import { Warnings } from './ui/Warnings.js';

export { showUpdateNotice } from './state.js';

export function App() {
  const editorRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const hiddenRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const renderer = new Renderer(previewRef.current!, hiddenRef.current!);
    renderer.onPresent = (slide) => void present(slide);
    renderer.onJump = jumpToSlide;
    const editor = createEditor(editorRef.current!, {
      text: '',
      onChange,
      onSave: () => void save(),
      onPresent: () => void present(),
      onCursor,
      onCheatSheet: toggleCheatSheet,
      assist: {
        files: assetCandidates,
        layoutAt: (line) => slideInfoAt(editor.view, line)?.layout,
      },
      gutter: {
        onAutoBreak: (line, rect) => (breakMenu.value = { line, x: rect.right + 4, y: rect.top }),
        onSlide: showSlide,
      },
    });
    attach(editor, renderer);
    void start();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        breakMenu.value = null;
        // 早見表・GitHub の画面・警告の一覧を閉じて、そのまま書けるようにする（#164）。
        // エディタの補完の候補を閉じた Esc（defaultPrevented）では閉じない
        if (
          !event.defaultPrevented &&
          (cheatOpen.value || githubOpen.value || showWarnings.value)
        ) {
          cheatOpen.value = false;
          githubOpen.value = false;
          showWarnings.value = false;
          editor.view.focus();
        }
      }
      if ((event.ctrlKey || event.metaKey) && event.key === 's') {
        event.preventDefault();
        void save();
      }
    };
    const dragover = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault();
      dragging.value = true;
    };
    const dragleave = (event: DragEvent) => {
      if (event.relatedTarget === null) dragging.value = false;
    };
    const drop = (event: DragEvent) => {
      event.preventDefault();
      dragging.value = false;
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length > 0) void openFiles(files);
    };
    window.addEventListener('keydown', keydown);
    window.addEventListener('dragover', dragover);
    window.addEventListener('dragleave', dragleave);
    window.addEventListener('drop', drop);
    const stopViewport = followVisualViewport();
    return () => {
      stopViewport();
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('dragover', dragover);
      window.removeEventListener('dragleave', dragleave);
      window.removeEventListener('drop', drop);
    };
  }, []);

  return (
    <div class={`app${keyboard.value ? ' keyboard-open' : ''}`}>
      <Toolbar />
      <Menu />
      <NoticeBar />
      <main class={`workspace pane-${pane.value}${folder.value ? ' has-files' : ''}`}>
        <FileList />
        <section class="editor" ref={editorRef} aria-label="エディタ" />
        <section class="preview" ref={previewRef} aria-label="プレビュー">
          <CheatSheet />
        </section>
      </main>
      <StatusBar />
      <Warnings />
      <BreakMenu />
      <GitHubDialog />
      {dragging.value && <div class="drop">ここに落とすと開きます（.md と画像・動画）</div>}
      <div class="hidden-frames" ref={hiddenRef} aria-hidden="true" />
    </div>
  );
}
