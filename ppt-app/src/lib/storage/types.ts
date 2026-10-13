export interface StorageUploadInput {
  key: string;
  data: Uint8Array;
  mimeType: string;
}

export interface StorageFileUploadInput {
  key: string;
  filePath: string;
  mimeType: string;
  size: number;
}

export interface StoredObject {
  key: string;
  size: number;
  etag?: string;
}

export interface StorageObject {
  data: Uint8Array;
  mimeType?: string;
  size?: number;
}

export interface StorageProvider {
  health(): Promise<void>;
  upload(input: StorageUploadInput): Promise<StoredObject>;
  uploadFile(input: StorageFileUploadInput): Promise<StoredObject>;
  delete(key: string): Promise<void>;
  getObject(key: string): Promise<StorageObject>;
  getUrl(key: string, expiresInSeconds?: number): Promise<string>;
}
