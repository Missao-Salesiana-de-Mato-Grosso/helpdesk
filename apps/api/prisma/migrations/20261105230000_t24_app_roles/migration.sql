-- T24 (ADR-012): papéis concedidos pela tela de usuários. `roles` passa a ser o efetivo
-- (zitadel_roles ∪ app_roles); até aqui ele era só o cache do token, que vira zitadel_roles.

-- AlterTable
ALTER TABLE "users"
  ADD COLUMN "zitadel_roles" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "app_roles" TEXT[] DEFAULT ARRAY[]::TEXT[];

UPDATE "users" SET "zitadel_roles" = "roles";
