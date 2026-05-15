// Set required env vars before any module loads config.ts
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test_kitchen';
process.env.JWT_SECRET = 'test-secret-string-that-is-at-least-32-characters-long';
process.env.JWT_ACCESS_EXPIRES_IN = '30m';
process.env.JWT_REFRESH_EXPIRES_IN = '30d';
process.env.S3_ENDPOINT = 'http://localhost:9000';
process.env.S3_ACCESS_KEY_ID = 'testkey';
process.env.S3_SECRET_ACCESS_KEY = 'testsecret';
process.env.S3_BUCKET = 'test-bucket';
process.env.S3_PUBLIC_URL = 'http://localhost:9000/test-bucket';
process.env.S3_REGION = 'us-east-1';
process.env.NODE_ENV = 'test';
process.env.PORT = '3001';
process.env.CORS_ORIGIN = 'http://localhost:8080';
process.env.RATE_LIMIT_PER_MINUTE = '1000';
