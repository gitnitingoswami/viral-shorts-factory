import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { CreateBucketCommand, GetObjectCommand, HeadBucketCommand, HeadObjectCommand, PutObjectCommand, S3Client, S3ServiceException } from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';
import { ConfigService } from '@nestjs/config';
import type { AppEnv } from '../config/env.schema';

/** S3-compatible object storage (SeaweedFS locally; S3 or an S3-compatible gateway in the cloud). */
@Injectable()
export class StorageService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StorageService.name);
  readonly bucket: string;
  private readonly client: S3Client;
  private readonly autoCreate: boolean;

  constructor(config: ConfigService<AppEnv, true>) {
    const c = config;
    this.bucket = c.get('STORAGE_BUCKET', { infer: true });
    this.autoCreate = c.get('STORAGE_AUTO_CREATE_BUCKET', { infer: true });
    this.client = new S3Client({
      region: c.get('STORAGE_REGION', { infer: true }),
      endpoint: c.get('STORAGE_ENDPOINT', { infer: true }),
      forcePathStyle: c.get('STORAGE_FORCE_PATH_STYLE', { infer: true }),
      credentials: {
        accessKeyId: c.get('STORAGE_ACCESS_KEY', { infer: true }),
        secretAccessKey: c.get('STORAGE_SECRET_KEY', { infer: true }),
      },
      maxAttempts: 2,
    });
  }

  async onModuleInit(): Promise<void> {
    if (!this.autoCreate) return;
    try {
      await this.ensureBucket();
    } catch (err) {
      // Never block boot on storage; readiness reports it as down instead.
      this.logger.warn({ err }, `Could not ensure bucket "${this.bucket}"`);
    }
  }

  onModuleDestroy(): void {
    this.client.destroy();
  }

  /** Readiness probe: the configured bucket must exist and be accessible. */
  async ping(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (err) {
      const status = err instanceof S3ServiceException ? err.$metadata.httpStatusCode : undefined;
      if (status !== 404) throw err;
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      this.logger.log(`Created bucket "${this.bucket}"`);
    }
  }

  /** Uploads a buffer, or a stream of known length (large media is streamed from disk, never buffered). */
  async putObject(key: string, body: Buffer | Readable, contentType: string, contentLength?: number): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType, ContentLength: contentLength }));
  }

  /** Size of a stored object, or null when it does not exist. */
  async headObject(key: string): Promise<{ bytes: number } | null> {
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { bytes: Number(res.ContentLength ?? 0) };
    } catch (err) {
      const status = err instanceof S3ServiceException ? err.$metadata.httpStatusCode : undefined;
      if (status === 404) return null;
      throw err;
    }
  }

  /** Streams an object, optionally a byte range ("bytes=start-end"), for media playback. */
  async getObject(key: string, range?: string): Promise<{ body: Readable; contentLength: number; contentRange: string | null }> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: range }));
    return { body: res.Body as Readable, contentLength: Number(res.ContentLength ?? 0), contentRange: res.ContentRange ?? null };
  }

  async getObjectBuffer(key: string): Promise<Buffer> {
    const { body } = await this.getObject(key);
    const chunks: Buffer[] = [];
    for await (const chunk of body) chunks.push(Buffer.from(chunk as Uint8Array));
    return Buffer.concat(chunks);
  }
}
