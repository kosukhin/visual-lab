/**
 * В lib.dom пока нет File System Access API (пикеры) и permission-методов
 * у FileSystemHandle, поэтому описываем их сами.
 */

export {};

interface FilePickerAcceptType {
  description?: string;
  accept: Record<string, string[]>;
}

export interface FilePickerOptions {
  suggestedName?: string;
  types?: FilePickerAcceptType[];
  excludeAcceptAllOption?: boolean;
  multiple?: boolean;
  id?: string;
  startIn?: 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos';
}

declare global {
  interface Window {
    showSaveFilePicker?: (options?: FilePickerOptions) => Promise<FileSystemFileHandle>;
    showOpenFilePicker?: (options?: FilePickerOptions) => Promise<FileSystemFileHandle[]>;
  }

  interface FileSystemHandle {
    queryPermission?: (descriptor?: {
      mode?: 'read' | 'readwrite';
    }) => Promise<PermissionState>;
    requestPermission?: (descriptor?: {
      mode?: 'read' | 'readwrite';
    }) => Promise<PermissionState>;
  }
}
