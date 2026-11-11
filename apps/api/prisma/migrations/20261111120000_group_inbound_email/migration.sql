-- Caixa de entrada por grupo (#42): e-mail novo para essa caixa abre o ticket no grupo.
ALTER TABLE "groups" ADD COLUMN "inbound_email" CITEXT;

CREATE UNIQUE INDEX "groups_inbound_email_key" ON "groups"("inbound_email");
