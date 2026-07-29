-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('BOOKED', 'CANCELLED', 'COMPLETED', 'NO_SHOW');

-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "booking_source" TEXT NOT NULL DEFAULT 'ONLINE',
ADD COLUMN     "cancellation_reason" TEXT,
ADD COLUMN     "cancelled_at" TIMESTAMP(3),
ADD COLUMN     "diagnosis" TEXT,
ADD COLUMN     "follow_up" TEXT,
ADD COLUMN     "prescription" TEXT,
ADD COLUMN     "status" "AppointmentStatus" NOT NULL DEFAULT 'BOOKED';

-- Create partial unique index on active appointments (same doctor, same slot)
CREATE UNIQUE INDEX unique_active_appointment ON appointments (doctor_profile_id, slot_start) WHERE status = 'BOOKED' AND slot_start IS NOT NULL AND appointment_type = 'STREAM';

-- Create partial unique index on active wave appointments (same wave, same patient)
CREATE UNIQUE INDEX unique_active_wave_appointment ON appointments (wave_schedule_id, patient_profile_id) WHERE status = 'BOOKED' AND wave_schedule_id IS NOT NULL;
