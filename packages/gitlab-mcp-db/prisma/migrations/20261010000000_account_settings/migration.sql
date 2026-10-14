-- Account settings: what an account chose in the settings page or through manage_context,
-- shared by every replica. Additive only: a new table.

-- CreateTable
CREATE TABLE "oauth_account_settings" (
    "account_key" TEXT NOT NULL,
    "settings" JSONB NOT NULL,
    "version" INTEGER NOT NULL,
    "updated_at" BIGINT NOT NULL,

    CONSTRAINT "oauth_account_settings_pkey" PRIMARY KEY ("account_key")
);
