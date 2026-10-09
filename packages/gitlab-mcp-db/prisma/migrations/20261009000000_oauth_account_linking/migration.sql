-- OAuth account linking: resource/scope/instance binding of flows and sessions, the
-- device flow's client state and poll cadence, the GitLab refresh lease, and durable
-- client registrations.
-- Additive only: new nullable columns and a new table; existing rows stay valid.

-- AlterTable
ALTER TABLE "oauth_sessions" ADD COLUMN     "gitlab_refresh_lease_until" BIGINT,
ADD COLUMN     "resource" TEXT;

-- AlterTable
ALTER TABLE "oauth_device_flows" ADD COLUMN     "client_state" TEXT,
ADD COLUMN     "mcp_scopes" JSONB,
ADD COLUMN     "next_poll_at" BIGINT,
ADD COLUMN     "resource" TEXT,
ADD COLUMN     "selected_instance" TEXT,
ADD COLUMN     "selected_instance_label" TEXT;

-- AlterTable
ALTER TABLE "oauth_auth_code_flows" ADD COLUMN     "mcp_scopes" JSONB,
ADD COLUMN     "resource" TEXT,
ADD COLUMN     "selected_instance" TEXT,
ADD COLUMN     "selected_instance_label" TEXT;

-- CreateTable
CREATE TABLE "oauth_clients" (
    "client_id" TEXT NOT NULL,
    "client_secret" TEXT,
    "redirect_uris" TEXT[],
    "client_name" TEXT,
    "token_endpoint_auth_method" TEXT NOT NULL,
    "grant_types" TEXT[],
    "response_types" TEXT[],
    "created_at" BIGINT NOT NULL,

    CONSTRAINT "oauth_clients_pkey" PRIMARY KEY ("client_id")
);
