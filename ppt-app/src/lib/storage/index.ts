import type { StorageProvider } from "./types";
import { LocalStorageProvider } from "./local";
import { S3StorageProvider } from "./s3";

let provider: StorageProvider | undefined;

export function getStorageProvider(): StorageProvider {
  if (provider) return provider;
  provider = process.env.STORAGE_PROVIDER === "s3" ? new S3StorageProvider() : new LocalStorageProvider();
  return provider;
}

export type { StorageProvider } from "./types";
