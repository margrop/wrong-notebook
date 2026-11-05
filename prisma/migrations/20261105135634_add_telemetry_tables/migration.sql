-- CreateTable
CREATE TABLE "TelemetryEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "payload" TEXT,
    "version" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "forwardedAt" DATETIME,
    "local" BOOLEAN NOT NULL
);

-- CreateTable
CREATE TABLE "TelemetryError" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "message" TEXT,
    "stack" TEXT,
    "path" TEXT,
    "userAgent" TEXT,
    "version" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "forwardedAt" DATETIME,
    "local" BOOLEAN NOT NULL
);

-- CreateIndex
CREATE INDEX "TelemetryEvent_createdAt_idx" ON "TelemetryEvent"("createdAt");

-- CreateIndex
CREATE INDEX "TelemetryEvent_forwardedAt_createdAt_idx" ON "TelemetryEvent"("forwardedAt", "createdAt");

-- CreateIndex
CREATE INDEX "TelemetryEvent_name_createdAt_idx" ON "TelemetryEvent"("name", "createdAt");

-- CreateIndex
CREATE INDEX "TelemetryError_createdAt_idx" ON "TelemetryError"("createdAt");

-- CreateIndex
CREATE INDEX "TelemetryError_forwardedAt_createdAt_idx" ON "TelemetryError"("forwardedAt", "createdAt");

-- CreateIndex
CREATE INDEX "TelemetryError_fingerprint_createdAt_idx" ON "TelemetryError"("fingerprint", "createdAt");
