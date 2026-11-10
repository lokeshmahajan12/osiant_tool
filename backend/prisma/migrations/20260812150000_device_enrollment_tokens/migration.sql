-- Enrollment tokens: single-use, time-limited invite links.
CREATE TABLE "EnrollmentToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'Device enrollment',
    "deviceName" TEXT,
    "platform" "DevicePlatform",
    "phone" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnrollmentToken_pkey" PRIMARY KEY ("id")
);

-- Device: consent/status fields and the link back to the enrollment token.
ALTER TABLE "Device" ADD COLUMN "browser" TEXT,
ADD COLUMN "os" TEXT,
ADD COLUMN "enrollmentTokenId" TEXT,
ADD COLUMN "status" TEXT NOT NULL DEFAULT 'OFFLINE',
ADD COLUMN "locationSharing" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "permissionStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN "isTestDevice" BOOLEAN NOT NULL DEFAULT false;

-- ConsentRecord maps to the legacy "LocationConsent" table; add permission flag.
ALTER TABLE "LocationConsent" ADD COLUMN "locationPermission" BOOLEAN NOT NULL DEFAULT true;

-- Test-mode GPS fixes are stored with isTest so they are never shown as real data.
ALTER TABLE "LocationEvent" ADD COLUMN "isTest" BOOLEAN NOT NULL DEFAULT false;

-- Indexes and foreign keys.
CREATE UNIQUE INDEX "EnrollmentToken_tokenHash_key" ON "EnrollmentToken"("tokenHash");
CREATE INDEX "EnrollmentToken_userId_idx" ON "EnrollmentToken"("userId");
CREATE UNIQUE INDEX "Device_enrollmentTokenId_key" ON "Device"("enrollmentTokenId");

ALTER TABLE "EnrollmentToken" ADD CONSTRAINT "EnrollmentToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Device" ADD CONSTRAINT "Device_enrollmentTokenId_fkey" FOREIGN KEY ("enrollmentTokenId") REFERENCES "EnrollmentToken"("id") ON DELETE SET NULL ON UPDATE CASCADE;
