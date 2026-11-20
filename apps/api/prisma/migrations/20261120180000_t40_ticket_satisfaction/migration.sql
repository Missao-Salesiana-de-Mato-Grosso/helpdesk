-- T40: pesquisa de satisfação (CSAT). Uma linha por chamado: o link atual (só o hash) e a última avaliação.
CREATE TABLE "ticket_satisfaction" (
    "ticket_id" UUID NOT NULL,
    "token_hash" TEXT,
    "requested_at" TIMESTAMPTZ(6) NOT NULL,
    "expires_at" TIMESTAMPTZ(6),
    "score" SMALLINT,
    "comment" TEXT,
    "rated_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ticket_satisfaction_pkey" PRIMARY KEY ("ticket_id"),
    CONSTRAINT "ticket_satisfaction_score_check" CHECK ("score" BETWEEN 1 AND 5)
);

CREATE UNIQUE INDEX "ticket_satisfaction_token_hash_key" ON "ticket_satisfaction"("token_hash");
CREATE INDEX "ticket_satisfaction_rated_at_idx" ON "ticket_satisfaction"("rated_at");
CREATE INDEX "ticket_satisfaction_requested_at_idx" ON "ticket_satisfaction"("requested_at");

ALTER TABLE "ticket_satisfaction" ADD CONSTRAINT "ticket_satisfaction_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
