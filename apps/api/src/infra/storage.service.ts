import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { CreateBucketCommand, HeadBucketCommand, S3Client, S3ServiceException } from '@aws-sdk/client-s3';
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
}
