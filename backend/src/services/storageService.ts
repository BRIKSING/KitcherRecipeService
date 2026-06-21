import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl as presignUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config.js';

const s3Client = new S3Client({
  endpoint: config.S3_ENDPOINT,
  region: config.S3_REGION,
  credentials: {
    accessKeyId: config.S3_ACCESS_KEY_ID,
    secretAccessKey: config.S3_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true,
});

export const storageService = {
  getClient(): S3Client {
    return s3Client;
  },

  async upload(key: string, body: Buffer, contentType: string): Promise<void> {
    await s3Client.send(
      new PutObjectCommand({
        Bucket: config.S3_BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  },

  async delete(key: string): Promise<void> {
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: config.S3_BUCKET,
        Key: key,
      }),
    );
  },

  async deleteMany(keys: string[]): Promise<void> {
    await Promise.allSettled(keys.map((key) => this.delete(key)));
  },

  async headBucket(): Promise<void> {
    await s3Client.send(new HeadBucketCommand({ Bucket: config.S3_BUCKET }));
  },

  /**
   * Generates a time-limited presigned GET URL for a stored object.
   * Useful for serving private objects without exposing bucket credentials
   * (spec §3.2 storageService: upload / delete / getSignedUrl).
   */
  async getSignedUrl(key: string, expiresInSec = 3600): Promise<string> {
    return presignUrl(
      s3Client,
      new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: key }),
      { expiresIn: expiresInSec },
    );
  },

  buildPublicUrl(key: string): string {
    return `${config.S3_PUBLIC_URL}/${key}`;
  },
};
