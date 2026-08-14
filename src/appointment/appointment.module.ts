import { Module } from '@nestjs/common';
import { AppointmentService } from './appointment.service';
import { AppointmentController } from './appointment.controller';
import { ReminderService } from './reminder.service';

@Module({
  controllers: [AppointmentController],
  providers: [AppointmentService, ReminderService],
  exports: [AppointmentService, ReminderService],
})
export class AppointmentModule {}
