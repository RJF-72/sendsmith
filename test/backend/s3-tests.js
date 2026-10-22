const assert = require('assert');
const sinon = require('sinon');
const { PassThrough } = require('stream');
const proxyquire = require('proxyquire').noCallThru();

/*
 * NOTE (SendSmith modernization): this suite was rewritten when the
 * storage backend moved from aws-sdk v2 to the AWS SDK for JavaScript
 * v3. The original tests stubbed the v2 `aws-sdk` module shape
 * (`.promise()`, `s3.upload()`, ...), which no longer exists. The
 * behaviors asserted are the same as upstream's suite; only the stub
 * shape changed to v3 commands + the lib-storage Upload helper.
 */

class FakeCommand {
  constructor(input) {
    this.input = input;
  }
}
class HeadObjectCommand extends FakeCommand {}
class GetObjectCommand extends FakeCommand {}
class DeleteObjectCommand extends FakeCommand {}
class HeadBucketCommand extends FakeCommand {}

const sendStub = sinon.stub();
class FakeS3Client {
  constructor(cfg) {
    this.cfg = cfg;
  }
  send(command) {
    return sendStub(command);
  }
}

const uploadInstances = [];
class FakeUpload {
  constructor(opts) {
    this.opts = opts;
    const impl = FakeUpload.nextDoneImpl || (() => Promise.resolve());
    FakeUpload.nextDoneImpl = null;
    this.done = sinon.stub().callsFake(impl);
    this.abort = sinon.stub().resolves();
    uploadInstances.push(this);
  }
}

const S3Storage = proxyquire('../../server/storage/s3', {
  '@aws-sdk/client-s3': {
    S3Client: FakeS3Client,
    HeadObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
    HeadBucketCommand
  },
  '@aws-sdk/lib-storage': { Upload: FakeUpload }
});

describe('S3Storage', function() {
  beforeEach(function() {
    sendStub.reset();
    uploadInstances.length = 0;
    FakeUpload.nextDoneImpl = null;
  });

  it('uses config.s3_bucket', function() {
    const s = new S3Storage({ s3_bucket: 'foo' });
    assert.equal(s.bucket, 'foo');
  });

  it('passes endpoint and path-style config to the client', function() {
    const s = new S3Storage({
      s3_bucket: 'foo',
      s3_endpoint: 'https://example.r2.cloudflarestorage.com',
      s3_use_path_style_endpoint: true,
      s3_region: 'auto'
    });
    assert.equal(
      s.s3.cfg.endpoint,
      'https://example.r2.cloudflarestorage.com'
    );
    assert.equal(s.s3.cfg.forcePathStyle, true);
    assert.equal(s.s3.cfg.region, 'auto');
  });

  describe('length', function() {
    it('returns the ContentLength', async function() {
      sendStub.resolves({ ContentLength: 123 });
      const s = new S3Storage({ s3_bucket: 'foo' });
      const len = await s.length('x');
      assert.equal(len, 123);
      const cmd = sendStub.firstCall.args[0];
      assert.ok(cmd instanceof HeadObjectCommand);
      assert.deepEqual(cmd.input, { Bucket: 'foo', Key: 'x' });
    });

    it('throws when id not found', async function() {
      const err = new Error('not found');
      sendStub.rejects(err);
      const s = new S3Storage({ s3_bucket: 'foo' });
      try {
        await s.length('x');
        assert.fail();
      } catch (e) {
        assert.equal(e, err);
      }
    });
  });

  describe('getStream', function() {
    it('returns a Stream that yields the object body', async function() {
      const body = new PassThrough();
      sendStub.resolves({ Body: body });
      const s = new S3Storage({ s3_bucket: 'foo' });
      const result = s.getStream('x');
      const cmd = sendStub.firstCall.args[0];
      assert.ok(cmd instanceof GetObjectCommand);
      assert.deepEqual(cmd.input, { Bucket: 'foo', Key: 'x' });
      const chunks = [];
      result.on('data', c => chunks.push(c));
      const ended = new Promise(resolve => result.on('end', resolve));
      body.write('hello');
      body.end();
      await ended;
      assert.equal(Buffer.concat(chunks).toString(), 'hello');
    });
  });

  describe('set', function() {
    it('uploads via lib-storage with bucket/key/body', async function() {
      const file = new PassThrough();
      const s = new S3Storage({ s3_bucket: 'foo' });
      await s.set('x', file);
      assert.equal(uploadInstances.length, 1);
      assert.deepEqual(uploadInstances[0].opts.params, {
        Bucket: 'foo',
        Key: 'x',
        Body: file
      });
      sinon.assert.calledOnce(uploadInstances[0].done);
    });

    it('aborts the upload if the source stream errors', async function() {
      const file = new PassThrough();
      const err = new Error('limit');
      FakeUpload.nextDoneImpl = () => Promise.reject(err);
      const s = new S3Storage({ s3_bucket: 'foo' });
      const promise = s.set('x', file);
      file.emit('error', err);
      try {
        await promise;
        assert.fail();
      } catch (e) {
        assert.equal(e, err);
        sinon.assert.calledOnce(uploadInstances[0].abort);
      }
    });
  });

  describe('del', function() {
    it('sends a DeleteObjectCommand', async function() {
      sendStub.resolves({ Deleted: true });
      const s = new S3Storage({ s3_bucket: 'foo' });
      const result = await s.del('x');
      assert.deepEqual(result, { Deleted: true });
      const cmd = sendStub.firstCall.args[0];
      assert.ok(cmd instanceof DeleteObjectCommand);
      assert.deepEqual(cmd.input, { Bucket: 'foo', Key: 'x' });
    });
  });

  describe('ping', function() {
    it('sends a HeadBucketCommand', async function() {
      sendStub.resolves({});
      const s = new S3Storage({ s3_bucket: 'foo' });
      await s.ping();
      const cmd = sendStub.firstCall.args[0];
      assert.ok(cmd instanceof HeadBucketCommand);
      assert.deepEqual(cmd.input, { Bucket: 'foo' });
    });
  });
});
