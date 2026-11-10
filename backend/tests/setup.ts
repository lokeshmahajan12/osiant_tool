process.env.NODE_ENV = "test";
process.env.MOCK_MODE = "true";
process.env.JWT_SECRET = "test-secret-that-is-long-enough-for-signing-123456789";
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://osint:osint@localhost:5432/osint?schema=public";
process.env.ADMIN_EMAIL = "admin@test.local";
process.env.ADMIN_PASSWORD = "AdminTest12345";
process.env.CORS_ORIGINS = "http://localhost:5173";
