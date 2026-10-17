-- Linked GitLab accounts: a session row can belong to another session, and an
-- authorization flow can link an account instead of signing a client in.
-- Additive only: new nullable columns, an index and a foreign key; existing rows stay valid.

-- AlterTable
ALTER TABLE "oauth_sessions" ADD COLUMN     "linked_to_session_id" TEXT;

-- AlterTable
ALTER TABLE "oauth_auth_code_flows" ADD COLUMN     "link" JSONB;

-- CreateIndex
CREATE INDEX "idx_oauth_sessions_linked_to_session_id" ON "oauth_sessions"("linked_to_session_id");

-- AddForeignKey
ALTER TABLE "oauth_sessions" ADD CONSTRAINT "oauth_sessions_linked_to_session_id_fkey" FOREIGN KEY ("linked_to_session_id") REFERENCES "oauth_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
