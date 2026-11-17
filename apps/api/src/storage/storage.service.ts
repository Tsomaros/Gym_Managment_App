import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getEnv } from '../config/env';

/** S3-compatible object storage (MinIO locally). Objects are private; reads use signed links. */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly log = new Logger(StorageService.name);
  private readonly bucket = getEnv().S3_BUCKET;
  private readonly client = new S3Client({
    endpoint: getEnv().S3_ENDPOINT,
    region: getEnv().S3_REGION,
    credentials: { accessKeyId: getEnv().S3_ACCESS_KEY, secretAccessKey: getEnv().S3_SECRET_KEY },
    forcePathStyle: true,
    maxAttempts: 2,
    requestHandler: { connectionTimeout: 2000, requestTimeout: 15_000 },
  });
  private ready: Promise<void> | undefined;

  /** Creates the bucket when missing. A store that is down at start-up does not stop the API. */
  async onModuleInit(): Promise<void> {
    await this.ensureBucket().catch((err: Error) =>
      this.log.warn(`Object storage not reachable at start-up (${err.message}); retrying on use`),
    );
  }

  ensureBucket(): Promise<void> {
    this.ready ??= (async () => {
      try {
        await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      } catch (e) {
        // Only a missing bucket is created; a wrong key or a network error must surface as is.
        const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
        if (err.$metadata?.httpStatusCode !== 404 && err.name !== 'NotFound') throw e;
        await this.client
          .send(new CreateBucketCommand({ Bucket: this.bucket }))
          .catch((c: { name?: string }) => {
            if (c.name !== 'BucketAlreadyOwnedByYou') throw c; // another instance was faster
          });
      }
    })().catch((err: unknown) => {
      this.ready = undefined; // try again next time
      throw err;
    });
    return this.ready;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.ensureBucket();
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  /** Deleting a missing object is not an error. */
  async remove(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  /** A link that works for `seconds` (default 5 minutes), computed locally. */
  signedGetUrl(key: string, seconds = 300): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: seconds,
    });
  }
}
