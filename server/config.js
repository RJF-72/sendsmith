const convict = require('convict');
const { tmpdir } = require('os');
const path = require('path');
const net = require('net');
const { randomBytes } = require('crypto');

// Convict 6 removed the built-in 'ipaddress' and 'url' formats this
// schema was written against; re-register them with platform APIs.
convict.addFormat({
  name: 'ipaddress',
  validate: val => {
    if (!net.isIP(val)) {
      throw new Error('must be an IP address');
    }
  }
});
convict.addFormat({
  name: 'url',
  validate: val => {
    try {
      // eslint-disable-next-line no-new
      new URL(val);
    } catch (e) {
      throw new Error('must be a URL');
    }
  }
});

const conf = convict({
  s3_bucket: {
    format: String,
    default: '',
    env: 'S3_BUCKET'
  },
  s3_endpoint: {
    format: String,
    default: '',
    env: 'S3_ENDPOINT'
  },
  s3_use_path_style_endpoint: {
    format: Boolean,
    default: false,
    env: 'S3_USE_PATH_STYLE_ENDPOINT'
  },
  s3_region: {
    format: String,
    default: 'us-east-1',
    env: 'S3_REGION'
  },
  gcs_bucket: {
    format: String,
    default: '',
    env: 'GCS_BUCKET'
  },
  expire_times_seconds: {
    format: Array,
    default: [300, 3600, 86400, 604800],
    env: 'EXPIRE_TIMES_SECONDS'
  },
  default_expire_seconds: {
    format: Number,
    default: 86400,
    env: 'DEFAULT_EXPIRE_SECONDS'
  },
  max_expire_seconds: {
    format: Number,
    default: 86400 * 7,
    env: 'MAX_EXPIRE_SECONDS'
  },
  anon_max_expire_seconds: {
    format: Number,
    default: 86400,
    env: 'ANON_MAX_EXPIRE_SECONDS'
  },
  download_counts: {
    format: Array,
    default: [1, 2, 3, 4, 5, 20, 50, 100],
    env: 'DOWNLOAD_COUNTS'
  },
  max_downloads: {
    format: Number,
    default: 100,
    env: 'MAX_DOWNLOADS'
  },
  anon_max_downloads: {
    format: Number,
    default: 5,
    env: 'ANON_MAX_DOWNLOADS'
  },
  max_files_per_archive: {
    format: Number,
    default: 64,
    env: 'MAX_FILES_PER_ARCHIVE'
  },
  max_archives_per_user: {
    format: Number,
    default: 16,
    env: 'MAX_ARCHIVES_PER_USER'
  },
  redis_host: {
    format: String,
    default: 'mock',
    env: 'REDIS_HOST'
  },
  redis_port: {
    format: 'port',
    default: 6379,
    env: 'REDIS_PORT'
  },
  redis_password: {
    format: String,
    default: '',
    env: 'REDIS_PASSWORD'
  },
  redis_event_expire: {
    format: Boolean,
    default: false,
    env: 'REDIS_EVENT_EXPIRE'
  },
  redis_retry_time: {
    format: Number,
    default: 10000,
    env: 'REDIS_RETRY_TIME'
  },
  redis_retry_delay: {
    format: Number,
    default: 500,
    env: 'REDIS_RETRY_DELAY'
  },
  listen_address: {
    format: 'ipaddress',
    default: '0.0.0.0',
    env: 'IP_ADDRESS'
  },
  listen_port: {
    format: 'port',
    default: 1443,
    arg: 'port',
    env: 'PORT'
  },
  amplitude_id: {
    format: String,
    default: '',
    env: 'AMPLITUDE_ID'
  },
  analytics_id: {
    format: String,
    default: '',
    env: 'GOOGLE_ANALYTICS_ID'
  },
  sentry_id: {
    format: String,
    default: '',
    env: 'SENTRY_CLIENT'
  },
  sentry_dsn: {
    format: String,
    default: '',
    env: 'SENTRY_DSN'
  },
  sentry_host: {
    format: String,
    default: '',
    env: 'SENTRY_HOST'
  },
  env: {
    format: ['production', 'development', 'test'],
    default: 'development',
    env: 'NODE_ENV'
  },
  max_file_size: {
    format: Number,
    default: 1024 * 1024 * 1024 * 2.5,
    env: 'MAX_FILE_SIZE'
  },
  anon_max_file_size: {
    format: Number,
    // SendSmith default: anonymous uploads are capped well below
    // Mozilla's old 1 GB (see docs/abuse.md). Accounts get the larger
    // max_file_size limits.
    default: 200 * 1024 * 1024,
    env: 'ANON_MAX_FILE_SIZE'
  },
  session_ttl_seconds: {
    format: Number,
    default: 86400 * 30,
    env: 'SESSION_TTL_SECONDS'
  },
  free_monthly_quota_bytes: {
    format: Number,
    default: 2 * 1024 * 1024 * 1024,
    env: 'FREE_MONTHLY_QUOTA_BYTES'
  },
  pro_monthly_quota_bytes: {
    format: Number,
    default: 200 * 1024 * 1024 * 1024,
    env: 'PRO_MONTHLY_QUOTA_BYTES'
  },
  ratelimit_upload_max: {
    format: Number,
    default: 30,
    env: 'RATELIMIT_UPLOAD_MAX'
  },
  ratelimit_upload_window_seconds: {
    format: Number,
    default: 3600,
    env: 'RATELIMIT_UPLOAD_WINDOW_SECONDS'
  },
  ratelimit_download_max: {
    format: Number,
    default: 600,
    env: 'RATELIMIT_DOWNLOAD_MAX'
  },
  ratelimit_download_window_seconds: {
    format: Number,
    default: 3600,
    env: 'RATELIMIT_DOWNLOAD_WINDOW_SECONDS'
  },
  ratelimit_report_max: {
    format: Number,
    default: 10,
    env: 'RATELIMIT_REPORT_MAX'
  },
  ratelimit_report_window_seconds: {
    format: Number,
    default: 86400,
    env: 'RATELIMIT_REPORT_WINDOW_SECONDS'
  },
  ratelimit_auth_max: {
    format: Number,
    default: 30,
    env: 'RATELIMIT_AUTH_MAX'
  },
  ratelimit_auth_window_seconds: {
    format: Number,
    default: 3600,
    env: 'RATELIMIT_AUTH_WINDOW_SECONDS'
  },
  turnstile_site_key: {
    format: String,
    default: '',
    env: 'TURNSTILE_SITE_KEY'
  },
  turnstile_secret: {
    format: String,
    default: '',
    env: 'TURNSTILE_SECRET'
  },
  stripe_secret_key: {
    format: String,
    default: '',
    env: 'STRIPE_SECRET_KEY'
  },
  stripe_price_id: {
    format: String,
    default: '',
    env: 'STRIPE_PRICE_ID'
  },
  stripe_webhook_secret: {
    format: String,
    default: '',
    env: 'STRIPE_WEBHOOK_SECRET'
  },
  l10n_dev: {
    format: Boolean,
    default: false,
    env: 'L10N_DEV'
  },
  base_url: {
    format: 'url',
    default: 'http://localhost:1443',
    env: 'BASE_URL'
  },
  file_dir: {
    format: 'String',
    default: `${tmpdir()}${path.sep}send-${randomBytes(4).toString('hex')}`,
    env: 'FILE_DIR'
  },
  survey_url: {
    format: String,
    default: '',
    env: 'SURVEY_URL'
  },
  ip_db: {
    format: String,
    default: '',
    env: 'IP_DB'
  }
});

// Perform validation
conf.validate({ allowed: 'strict' });

const props = conf.getProperties();
module.exports = props;
