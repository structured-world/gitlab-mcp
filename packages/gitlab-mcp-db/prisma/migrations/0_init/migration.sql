-- Baseline: the schema before migrations were introduced. A database created by a release
-- is marked with `prisma migrate resolve --applied 0_init` instead of running it; the
-- columns released schemas lack are added by the next migration.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "oauth_sessions" (
    "id" TEXT NOT NULL,
    "mcp_access_token" TEXT NOT NULL,
    "mcp_refresh_token" TEXT NOT NULL,
    "mcp_token_expiry" BIGINT NOT NULL,
    "gitlab_access_token" TEXT NOT NULL,
    "gitlab_refresh_token" TEXT NOT NULL,
    "gitlab_token_expiry" BIGINT NOT NULL,
    "gitlab_scopes" JSONB,
    "gitlab_user_id" INTEGER NOT NULL,
    "gitlab_username" TEXT NOT NULL,
    "gitlab_api_url" TEXT,
    "instance_label" TEXT,
    "client_id" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,

    CONSTRAINT "oauth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_device_flows" (
    "state" TEXT NOT NULL,
    "device_code" TEXT NOT NULL,
    "user_code" TEXT NOT NULL,
    "verification_uri" TEXT NOT NULL,
    "verification_uri_complete" TEXT,
    "expires_at" BIGINT NOT NULL,
    "interval" INTEGER NOT NULL,
    "client_id" TEXT NOT NULL,
    "code_challenge" TEXT NOT NULL,
    "code_challenge_method" TEXT NOT NULL,
    "redirect_uri" TEXT,
    "requested_gitlab_scopes" JSONB,

    CONSTRAINT "oauth_device_flows_pkey" PRIMARY KEY ("state")
);

-- CreateTable
CREATE TABLE "oauth_auth_code_flows" (
    "internal_state" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "code_challenge" TEXT NOT NULL,
    "code_challenge_method" TEXT NOT NULL,
    "client_state" TEXT NOT NULL,
    "client_redirect_uri" TEXT NOT NULL,
    "callback_uri" TEXT NOT NULL,
    "expires_at" BIGINT NOT NULL,
    "requested_gitlab_scopes" JSONB,

    CONSTRAINT "oauth_auth_code_flows_pkey" PRIMARY KEY ("internal_state")
);

-- CreateTable
CREATE TABLE "oauth_authorization_codes" (
    "code" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "code_challenge" TEXT NOT NULL,
    "code_challenge_method" TEXT NOT NULL,
    "redirect_uri" TEXT,
    "expires_at" BIGINT NOT NULL,

    CONSTRAINT "oauth_authorization_codes_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "oauth_mcp_session_mappings" (
    "mcp_session_id" TEXT NOT NULL,
    "oauth_session_id" TEXT NOT NULL,

    CONSTRAINT "oauth_mcp_session_mappings_pkey" PRIMARY KEY ("mcp_session_id")
);

-- CreateIndex
CREATE INDEX "idx_oauth_sessions_mcp_access_token" ON "oauth_sessions"("mcp_access_token");

-- CreateIndex
CREATE INDEX "idx_oauth_sessions_mcp_refresh_token" ON "oauth_sessions"("mcp_refresh_token");

-- CreateIndex
CREATE INDEX "idx_oauth_sessions_gitlab_user_id" ON "oauth_sessions"("gitlab_user_id");

-- CreateIndex
CREATE INDEX "idx_oauth_device_flows_device_code" ON "oauth_device_flows"("device_code");

-- CreateIndex
CREATE INDEX "idx_oauth_device_flows_expires_at" ON "oauth_device_flows"("expires_at");

-- CreateIndex
CREATE INDEX "idx_oauth_auth_code_flows_expires_at" ON "oauth_auth_code_flows"("expires_at");

-- CreateIndex
CREATE INDEX "idx_oauth_authorization_codes_session_id" ON "oauth_authorization_codes"("session_id");

-- CreateIndex
CREATE INDEX "idx_oauth_authorization_codes_expires_at" ON "oauth_authorization_codes"("expires_at");

-- CreateIndex
CREATE INDEX "idx_oauth_mcp_session_mappings_oauth_session_id" ON "oauth_mcp_session_mappings"("oauth_session_id");

-- AddForeignKey
ALTER TABLE "oauth_authorization_codes" ADD CONSTRAINT "oauth_authorization_codes_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "oauth_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_mcp_session_mappings" ADD CONSTRAINT "oauth_mcp_session_mappings_oauth_session_id_fkey" FOREIGN KEY ("oauth_session_id") REFERENCES "oauth_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
