-- OAuth state values are one-time, hashed server-side records. This SQL uses
-- standard columns, indexes, and a foreign key supported by SQLite and PostgreSQL.
CREATE TABLE "OAuthAuthorizationState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "flow" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "actorId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "consumedAt" DATETIME,
    CONSTRAINT "OAuthAuthorizationState_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "OAuthAuthorizationState_stateHash_key" ON "OAuthAuthorizationState"("stateHash");
CREATE INDEX "OAuthAuthorizationState_provider_flow_expiresAt_idx" ON "OAuthAuthorizationState"("provider", "flow", "expiresAt");
CREATE INDEX "OAuthAuthorizationState_clientId_expiresAt_idx" ON "OAuthAuthorizationState"("clientId", "expiresAt");
