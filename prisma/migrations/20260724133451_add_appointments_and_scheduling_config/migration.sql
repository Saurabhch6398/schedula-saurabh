-- CreateEnum
CREATE TYPE "SchedulingType" AS ENUM ('STREAM', 'WAVE');

-- CreateEnum
CREATE TYPE "AppointmentType" AS ENUM ('STREAM', 'WAVE');

-- AlterTable
ALTER TABLE "doctor_profiles" ADD COLUMN     "buffer_time" INTEGER DEFAULT 0,
ADD COLUMN     "scheduling_type" "SchedulingType" NOT NULL DEFAULT 'STREAM',
ADD COLUMN     "slot_duration" INTEGER;

-- CreateTable
CREATE TABLE "wave_schedules" (
    "id" SERIAL NOT NULL,
    "doctor_profile_id" INTEGER NOT NULL,
    "start_time" TIMESTAMP(3) NOT NULL,
    "end_time" TIMESTAMP(3) NOT NULL,
    "max_capacity" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wave_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointments" (
    "id" SERIAL NOT NULL,
    "doctor_profile_id" INTEGER NOT NULL,
    "patient_profile_id" INTEGER NOT NULL,
    "appointment_type" "AppointmentType" NOT NULL,
    "slot_start" TIMESTAMP(3),
    "slot_end" TIMESTAMP(3),
    "token_number" INTEGER,
    "wave_schedule_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "wave_schedules" ADD CONSTRAINT "wave_schedules_doctor_profile_id_fkey" FOREIGN KEY ("doctor_profile_id") REFERENCES "doctor_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_doctor_profile_id_fkey" FOREIGN KEY ("doctor_profile_id") REFERENCES "doctor_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_profile_id_fkey" FOREIGN KEY ("patient_profile_id") REFERENCES "patient_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_wave_schedule_id_fkey" FOREIGN KEY ("wave_schedule_id") REFERENCES "wave_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
