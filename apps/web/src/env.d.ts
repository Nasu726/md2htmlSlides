/// <reference types="vite/client" />

declare module 'virtual:mds-fonts' {
  const faces: Array<{ family: string; weight: string; range: string; url: string }>;
  export default faces;
}

// File System Access API（Chrome・Edge）。TypeScript の DOM の型にない分
interface Window {
  showDirectoryPicker?: (options?: {
    mode?: 'read' | 'readwrite';
  }) => Promise<FileSystemDirectoryHandle>;
}
interface FileSystemDirectoryHandle {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
}
