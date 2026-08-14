import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';

@Injectable()
export class ReminderService {
  private readonly logger = new Logger(ReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {}

  @Cron('*/1 * * * *') // Run every minute
  async handleCron() {
    this.logger.log('Executing appointment reminder cron job...');
    const count = await this.checkReminders();
    if (count > 0) {
      this.logger.log(`Successfully sent ${count} appointment reminders.`);
    }
  }

  async checkReminders(): Promise<number> {
    const now = new Date();
    const windowHours = parseInt(process.env.REMINDER_WINDOW_HOURS || '24', 10);
    const reminderWindowMs = windowHours * 60 * 60 * 1000;
    const maxSlotStart = new Date(now.getTime() + reminderWindowMs);

    // Fetch active BOOKED appointments within the reminder window
    const appointments = await this.prisma.appointment.findMany({
      where: {
        status: 'BOOKED',
        slotStart: {
          gt: now,
          lte: maxSlotStart,
        },
      },
      include: {
        doctorProfile: true,
        patientProfile: true,
      },
    });

    let remindersSent = 0;

    for (const app of appointments) {
      try {
        if (!app.patientProfile || !app.doctorProfile || !app.slotStart) {
          continue;
        }

        // Verify if reminder already exists for this appointment
        const existingReminder = await this.prisma.notification.findFirst({
          where: {
            appointmentId: app.id,
            type: 'APPOINTMENT_REMINDER',
          },
        });

        if (existingReminder) {
          continue;
        }

        // Trigger notification in a transaction context for consistency
        await this.prisma.$transaction(async (tx) => {
          await this.notificationService.triggerNotification(
            tx,
            app.id,
            'APPOINTMENT_REMINDER',
          );
        });

        remindersSent++;
      } catch (error) {
        this.logger.error(
          `Failed to generate reminder for appointment ID ${app.id}: ${error.message}`,
          error.stack,
        );
      }
    }

    return remindersSent;
  }
}
