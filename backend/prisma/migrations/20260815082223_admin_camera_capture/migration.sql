-- CreateTable
CREATE TABLE "CameraCaptureRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "actorId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "CameraCaptureRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CameraFrame" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'image/jpeg',
    "width" INTEGER NOT NULL DEFAULT 640,
    "height" INTEGER NOT NULL DEFAULT 480,
    "image" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CameraFrame_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CameraCaptureRequest_userId_idx" ON "CameraCaptureRequest"("userId");

-- CreateIndex
CREATE INDEX "CameraCaptureRequest_status_idx" ON "CameraCaptureRequest"("status");

-- CreateIndex
CREATE INDEX "CameraCaptureRequest_requestedAt_idx" ON "CameraCaptureRequest"("requestedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CameraFrame_requestId_key" ON "CameraFrame"("requestId");

-- CreateIndex
CREATE INDEX "CameraFrame_userId_idx" ON "CameraFrame"("userId");

-- CreateIndex
CREATE INDEX "CameraFrame_capturedAt_idx" ON "CameraFrame"("capturedAt");

-- AddForeignKey
ALTER TABLE "CameraCaptureRequest" ADD CONSTRAINT "CameraCaptureRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CameraFrame" ADD CONSTRAINT "CameraFrame_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CameraFrame" ADD CONSTRAINT "CameraFrame_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "CameraCaptureRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
