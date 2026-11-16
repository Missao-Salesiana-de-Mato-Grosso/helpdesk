-- T31 (#45): assinatura de e-mail do agente, acrescentada ao `reply` no envio.
ALTER TABLE "users" ADD COLUMN "signature_html" TEXT;
