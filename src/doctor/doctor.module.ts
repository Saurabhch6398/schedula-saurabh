import { Module } from '@nestjs/common';
import { DoctorService } from './doctor.service';
import { DoctorController, PatientDoctorController } from './doctor.controller';
import { AvailabilityController } from './availability.controller';
import { AvailabilityService } from './availability.service';
import { AvailabilityRepository } from './availability.repository';
import { AppointmentModule } from '../appointment/appointment.module';

@Module({
  imports: [AppointmentModule],
  controllers: [DoctorController, AvailabilityController, PatientDoctorController],
  providers: [DoctorService, AvailabilityService, AvailabilityRepository],
})
export class DoctorModule {}
