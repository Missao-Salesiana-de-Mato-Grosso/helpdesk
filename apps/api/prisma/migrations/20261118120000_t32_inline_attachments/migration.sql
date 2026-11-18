-- T32: imagens inseridas no texto da mensagem.
ALTER TABLE "attachments" ADD COLUMN "inline" BOOLEAN NOT NULL DEFAULT false;
