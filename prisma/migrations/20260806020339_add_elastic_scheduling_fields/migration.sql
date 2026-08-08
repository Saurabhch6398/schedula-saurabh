-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "is_rescheduled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "original_slot_end" TIMESTAMP(3),
ADD COLUMN     "original_slot_start" TIMESTAMP(3),
ADD COLUMN     "original_token_number" INTEGER,
ADD COLUMN     "original_wave_schedule_id" INTEGER,
ADD COLUMN     "reschedule_accepted" BOOLEAN,
ADD COLUMN     "rescheduling_metadata" TEXT;

-- CreateTable
CREATE TABLE "appointment_queues" (
    "id" SERIAL NOT NULL,
    "doctor_profile_id" INTEGER NOT NULL,
    "patient_profile_id" INTEGER NOT NULL,
    "appointment_id" INTEGER,
    "queue_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "offered_slot_start" TIMESTAMP(3),
    "offered_slot_end" TIMESTAMP(3),
    "offered_wave_schedule_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointment_queues_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "appointment_queues" ADD CONSTRAINT "appointment_queues_doctor_profile_id_fkey" FOREIGN KEY ("doctor_profile_id") REFERENCES "doctor_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_queues" ADD CONSTRAINT "appointment_queues_patient_profile_id_fkey" FOREIGN KEY ("patient_profile_id") REFERENCES "patient_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_queues" ADD CONSTRAINT "appointment_queues_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
