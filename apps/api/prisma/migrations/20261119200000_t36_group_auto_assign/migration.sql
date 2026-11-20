-- T36: distribuição automática (round-robin) por grupo.
ALTER TABLE "groups" ADD COLUMN "auto_assign" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "groups" ADD COLUMN "last_auto_assignee_id" UUID;

ALTER TABLE "groups" ADD CONSTRAINT "groups_last_auto_assignee_id_fkey" FOREIGN KEY ("last_auto_assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
