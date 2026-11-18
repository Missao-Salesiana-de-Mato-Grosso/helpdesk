-- T33: imagens da assinatura de e-mail do agente.
CREATE TABLE "signature_images" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signature_images_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "signature_images_user_id_idx" ON "signature_images"("user_id");

ALTER TABLE "signature_images" ADD CONSTRAINT "signature_images_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
