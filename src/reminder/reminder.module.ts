import { Module } from '@nestjs/common';
import { ReminderService } from './reminder.service';
import { NotificationModule } from '../notification/notification.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule, NotificationModule],
  providers: [ReminderService],
  exports: [ReminderService],
})
export class ReminderModule {}
