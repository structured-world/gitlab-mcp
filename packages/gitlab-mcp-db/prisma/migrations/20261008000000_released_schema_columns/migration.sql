-- Columns of 0_init that databases created by a release before migrations shipped lack:
-- no release created the scope columns, and releases before multi-instance support also
-- lacked the instance columns. Such databases are baselined as 0_init, so the columns
-- they miss are added here; on a database 0_init created this changes nothing.

-- AlterTable
ALTER TABLE "oauth_sessions" ADD COLUMN IF NOT EXISTS "gitlab_api_url" TEXT,
ADD COLUMN IF NOT EXISTS "instance_label" TEXT,
ADD COLUMN IF NOT EXISTS "gitlab_scopes" JSONB;

-- AlterTable
ALTER TABLE "oauth_device_flows" ADD COLUMN IF NOT EXISTS "requested_gitlab_scopes" JSONB;

-- AlterTable
ALTER TABLE "oauth_auth_code_flows" ADD COLUMN IF NOT EXISTS "requested_gitlab_scopes" JSONB;
