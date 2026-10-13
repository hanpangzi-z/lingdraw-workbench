import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createReadStream } from "node:fs";
import type { StorageProvider } from "./types";

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} 未配置`);
  return value;
}

export class S3StorageProvider implements StorageProvider {
  private readonly bucket = required("S3_BUCKET");
  private readonly client = new S3Client({
    region: process.env.S3_REGION || "auto",
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    credentials: {
      accessKeyId: required("S3_ACCESS_KEY"),
      secretAccessKey: required("S3_SECRET_KEY"),
    },
  });

  async health() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }), { abortSignal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  async upload(input: { key: string; data: Uint8Array; mimeType: string }) {
    const result = await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: input.key, Body: input.data, ContentType: input.mimeType }));
    return { key: input.key, size: input.data.byteLength, etag: result.ETag };
  }

  async uploadFile(input: { key: string; filePath: string; mimeType: string; size: number }) {
    const result = await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: input.key,
      Body: createReadStream(input.filePath),
      ContentType: input.mimeType,
      ContentLength: input.size,
    }));
    return { key: input.key, size: input.size, etag: result.ETag };
  }

  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async getObject(key: string) {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!result.Body) throw new Error("存储对象不存在");
    return { data: await result.Body.transformToByteArray(), mimeType: result.ContentType, size: result.ContentLength };
  }

  async getUrl(key: string, expiresInSeconds = 3600) {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: expiresInSeconds });
  }
}
