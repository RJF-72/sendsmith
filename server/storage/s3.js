const { PassThrough } = require('stream');
const {
  S3Client,
  HeadObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand
} = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');

// Object storage via the standard S3 API (AWS SDK for JavaScript v3).
// Any S3-compatible provider works — set S3_ENDPOINT (and
// S3_USE_PATH_STYLE_ENDPOINT) for Cloudflare R2, Backblaze B2, MinIO,
// etc. The service is never locked to AWS itself.
class S3Storage {
  constructor(config, log) {
    this.bucket = config.s3_bucket;
    this.log = log;
    const cfg = {
      forcePathStyle: !!config.s3_use_path_style_endpoint,
      region: config.s3_region || 'us-east-1'
    };
    if (config.s3_endpoint) {
      cfg.endpoint = config.s3_endpoint;
    }
    this.s3 = new S3Client(cfg);
  }

  async length(id) {
    const result = await this.s3.send(
      new HeadObjectCommand({ Bucket: this.bucket, Key: id })
    );
    return Number(result.ContentLength);
  }

  getStream(id) {
    // The v2 SDK returned a stream synchronously; v3 is async, so hand
    // back a PassThrough immediately and pipe the object body into it
    // once the GetObject call resolves.
    const out = new PassThrough();
    this.s3
      .send(new GetObjectCommand({ Bucket: this.bucket, Key: id }))
      .then(result => {
        result.Body.pipe(out);
      })
      .catch(err => {
        out.destroy(err);
      });
    return out;
  }

  set(id, file) {
    const upload = new Upload({
      client: this.s3,
      params: {
        Bucket: this.bucket,
        Key: id,
        Body: file
      }
    });
    file.on('error', () => {
      upload.abort().catch(() => {});
    });
    return upload.done();
  }

  del(id) {
    return this.s3.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: id })
    );
  }

  ping() {
    return this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }
}

module.exports = S3Storage;
