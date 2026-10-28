-- T22 (ADR-011): liberação assistida de acesso ao portal.

-- CreateEnum
CREATE TYPE "user_access_status" AS ENUM ('pending', 'approved', 'rejected', 'trashed');

-- AlterTable
-- RN-02: quem já existe fica "approved" (o default nasce assim para o backfill desta própria
-- ALTER TABLE; a 2ª ALTER COLUMN abaixo troca o default para "pending" só para linhas futuras, RN-03).
ALTER TABLE "users"
  ADD COLUMN "access_status" "user_access_status" NOT NULL DEFAULT 'approved',
  ADD COLUMN "access_requested_at" TIMESTAMPTZ(6),
  ADD COLUMN "access_decided_at" TIMESTAMPTZ(6),
  ADD COLUMN "access_decided_by" UUID,
  ADD COLUMN "access_note" TEXT,
  ADD COLUMN "trashed_at" TIMESTAMPTZ(6);

ALTER TABLE "users" ALTER COLUMN "access_status" SET DEFAULT 'pending';

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_access_decided_by_fkey" FOREIGN KEY ("access_decided_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
-- Índice parcial de verdade (só a fila de pendentes), escrito à mão: o Prisma não gera WHERE em @@index.
DROP INDEX IF EXISTS "users_access_requested_at_pending_idx";
CREATE INDEX "users_access_requested_at_pending_idx" ON "users" ("access_requested_at") WHERE "access_status" = 'pending';
