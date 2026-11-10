-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'USER';

-- CreateEnum
CREATE TYPE "PermissionType" AS ENUM ('LOCATION', 'CAMERA', 'MICROPHONE', 'NOTIFICATIONS');

-- CreateEnum
CREATE TYPE "PermissionState" AS ENUM ('NOT_REQUESTED', 'GRANTED', 'DENIED', 'REVOKED', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "CameraSessionStatus" AS ENUM ('ACTIVE', 'ENDED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "username" TEXT,
ADD COLUMN "mobile" TEXT,
ADD COLUMN "country" TEXT,
ADD COLUMN "state" TEXT,
ADD COLUMN "city" TEXT,
ADD COLUMN "profile" JSONB;

-- CreateTable
CREATE TABLE "PermissionRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "PermissionType" NOT NULL,
    "state" "PermissionState" NOT NULL DEFAULT 'NOT_REQUESTED',
    "consentVersion" TEXT NOT NULL DEFAULT '1.0',
    "privacyPolicyVersion" TEXT NOT NULL DEFAULT '1.0',
    "requestedAt" TIMESTAMP(3),
    "grantedAt" TIMESTAMP(3),
    "deniedAt" TIMESTAMP(3),
    "browser" TEXT,
    "os" TEXT,
    "deviceMeta" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PermissionRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CameraSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "CameraSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "mode" TEXT NOT NULL DEFAULT 'CAPTURE',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "endedBy" TEXT,
    CONSTRAINT "CameraSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'INFO',
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SecurityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitoringState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'INACTIVE',
    "startedAt" TIMESTAMP(3),
    "stoppedAt" TIMESTAMP(3),
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MonitoringState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_mobile_key" ON "User"("mobile");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_isActive_idx" ON "User"("isActive");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");

-- CreateIndex
CREATE INDEX "User_mobile_idx" ON "User"("mobile");

-- CreateIndex
CREATE UNIQUE INDEX "PermissionRecord_userId_type_key" ON "PermissionRecord"("userId", "type");

-- CreateIndex
CREATE INDEX "PermissionRecord_userId_idx" ON "PermissionRecord"("userId");

-- CreateIndex
CREATE INDEX "PermissionRecord_type_idx" ON "PermissionRecord"("type");

-- CreateIndex
CREATE INDEX "PermissionRecord_state_idx" ON "PermissionRecord"("state");

-- CreateIndex
CREATE INDEX "PermissionRecord_grantedAt_idx" ON "PermissionRecord"("grantedAt");

-- CreateIndex
CREATE INDEX "CameraSession_userId_idx" ON "CameraSession"("userId");

-- CreateIndex
CREATE INDEX "CameraSession_status_idx" ON "CameraSession"("status");

-- CreateIndex
CREATE INDEX "CameraSession_startedAt_idx" ON "CameraSession"("startedAt");

-- CreateIndex
CREATE INDEX "SecurityEvent_userId_idx" ON "SecurityEvent"("userId");

-- CreateIndex
CREATE INDEX "SecurityEvent_type_idx" ON "SecurityEvent"("type");

-- CreateIndex
CREATE INDEX "SecurityEvent_createdAt_idx" ON "SecurityEvent"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MonitoringState_userId_key" ON "MonitoringState"("userId");

-- AddForeignKey
ALTER TABLE "PermissionRecord" ADD CONSTRAINT "PermissionRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CameraSession" ADD CONSTRAINT "CameraSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityEvent" ADD CONSTRAINT "SecurityEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoringState" ADD CONSTRAINT "MonitoringState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
