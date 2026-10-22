## Setup

Run `docker build -t send:latest .` to create an image or `docker-compose up` to run a full testable stack. *We don't recommend using docker-compose for production.*

## Environment variables:

| Name             | Description
|------------------|-------------|
| `PORT`           | Port the server will listen on (defaults to 1443).
| `S3_BUCKET`  | The S3 bucket name.
| `REDIS_HOST` | Host name of the Redis server.
| `SENTRY_CLIENT` | Sentry Client ID (from your own Sentry instance)
| `SENTRY_DSN` | Sentry DSN (from your own Sentry instance)
| `MAX_FILE_SIZE` | in bytes (defaults to 2147483648)
| `NODE_ENV`       | "production"
| `BASE_URL`       | The HTTPS URL where traffic will be served (e.g. `https://send.firefox.com`)

## Example:

```sh
$ docker run --net=host -e 'NODE_ENV=production' \
  -e 'S3_BUCKET=testpilot-p2p-dev' \
  -e 'REDIS_HOST=dyf9s2r4vo3.bolxr4.0001.usw2.cache.amazonaws.com' \
  -e 'SENTRY_CLIENT=https://<public-key>@<your-sentry-host>/<project-id>' \
  -e 'SENTRY_DSN=https://<public-key>:<secret>@<your-sentry-host>/<project-id>' \
  -e 'BASE_URL=https://send.firefox.com' \
  mozilla/send:latest
```
