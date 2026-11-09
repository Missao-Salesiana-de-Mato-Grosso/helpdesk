-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "first_response_due_at" TIMESTAMPTZ(6),
ADD COLUMN     "resolution_due_at" TIMESTAMPTZ(6),
ADD COLUMN     "sla_paused_at" TIMESTAMPTZ(6),
ADD COLUMN     "sla_paused_minutes" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "sla_policies" (
    "priority" "ticket_priority" NOT NULL,
    "first_response_minutes" INTEGER NOT NULL,
    "resolution_minutes" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sla_policies_pkey" PRIMARY KEY ("priority")
);

-- CreateTable
CREATE TABLE "business_hours" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "weekday" INTEGER NOT NULL,
    "start_minute" INTEGER NOT NULL,
    "end_minute" INTEGER NOT NULL,

    CONSTRAINT "business_hours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holidays" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "holidays_date_key" ON "holidays"("date");

-- CreateIndex
CREATE INDEX "tickets_status_resolution_due_at_idx" ON "tickets"("status", "resolution_due_at");

