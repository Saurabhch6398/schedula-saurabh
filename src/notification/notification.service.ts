import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

export type NotificationType =
  | 'APPOINTMENT_BOOKED'
  | 'APPOINTMENT_CANCELLED'
  | 'APPOINTMENT_RESCHEDULED'
  | 'APPOINTMENT_REMINDER';

function formatNotificationDate(date: Date): string {
  const day = date.getUTCDate();
  const monthNames = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  const monthName = monthNames[date.getUTCMonth()];

  let hours = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  const minutesStr = String(minutes).padStart(2, '0');

  return `${day} ${monthName} at ${hours}:${minutesStr} ${ampm}`;
}

function formatReminderDate(date: Date): string {
  const day = date.getUTCDate();
  const monthNames = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  const monthName = monthNames[date.getUTCMonth()];
  return `${day} ${monthName}`;
}

function formatReminderTime(date: Date): string {
  let hours = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  const minutesStr = String(minutes).padStart(2, '0');
  return `${hours}:${minutesStr} ${ampm}`;
}

@Injectable()
export class NotificationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Triggers a notification creation within a database transaction context to ensure consistency.
   * Prevents duplicate notification creation based on (userId, appointmentId, type, message).
   */
  async triggerNotification(
    tx: Prisma.TransactionClient,
    appointmentId: number,
    type: NotificationType,
  ) {
    // 1. Fetch appointment details including doctor and patient profiles
    const app = await tx.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        doctorProfile: true,
        patientProfile: true,
      },
    });

    if (!app) {
      throw new NotFoundException('Appointment not found');
    }

    if (!app.patientProfile) {
      throw new NotFoundException('Patient profile not found');
    }

    const patientUserId = app.patientProfile.userId;
    const dateFormatted = app.slotStart
      ? formatNotificationDate(app.slotStart)
      : '';

    let title = '';
    let message = '';

    if (type === 'APPOINTMENT_BOOKED') {
      title = 'Appointment Booked';
      message = `Your appointment with Dr. ${app.doctorProfile.fullName} has been booked successfully for ${dateFormatted}.`;
    } else if (type === 'APPOINTMENT_CANCELLED') {
      title = 'Appointment Cancelled';
      message = `Your appointment scheduled on ${dateFormatted} has been cancelled.`;
    } else if (type === 'APPOINTMENT_RESCHEDULED') {
      title = 'Appointment Rescheduled';
      message = `Your appointment has been rescheduled to ${dateFormatted}.`;
    } else if (type === 'APPOINTMENT_REMINDER') {
      title = 'Appointment Reminder';
      if (app.appointmentType === 'STREAM') {
        const appointmentDate = app.slotStart ? formatReminderDate(app.slotStart) : '';
        const appointmentTime = app.slotStart ? formatReminderTime(app.slotStart) : '';
        message = `Reminder: You have an appointment with Dr. ${app.doctorProfile.fullName} on ${appointmentDate} at ${appointmentTime}.`;
      } else {
        const reportingTime = app.slotStart ? formatReminderTime(app.slotStart) : '';
        const tokenNumber = app.tokenNumber ?? '';
        message = `Reminder: You have an appointment with Dr. ${app.doctorProfile.fullName} today.\n\nReporting Time: ${reportingTime}\nToken Number: ${tokenNumber}`;
      }
    }

    // 2. Duplicate Check: check if identical notification already exists to support idempotency
    const existing = await tx.notification.findFirst({
      where: {
        userId: patientUserId,
        appointmentId,
        type,
        message,
      },
    });

    if (existing) {
      return existing;
    }

    // 3. Create the notification
    return tx.notification.create({
      data: {
        userId: patientUserId,
        appointmentId,
        type,
        title,
        message,
      },
    });
  }

  /**
   * Fetches all notifications for the currently logged in user, latest first.
   */
  async getNotifications(userId: number) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Marks a notification as read after confirming user ownership.
   */
  async markAsRead(userId: number, notificationId: number) {
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    if (notification.userId !== userId) {
      throw new ForbiddenException(
        'You do not have access to mark this notification as read',
      );
    }

    return this.prisma.notification.update({
      where: { id: notificationId },
      data: { isRead: true },
    });
  }

  /**
   * Marks all notifications as read for the given user.
   */
  async markAllAsRead(userId: number) {
    await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
    return { message: 'All notifications marked as read' };
  }

  /**
   * Deletes a notification after confirming user ownership.
   */
  async deleteNotification(userId: number, notificationId: number) {
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    if (notification.userId !== userId) {
      throw new ForbiddenException(
        'You do not have access to delete this notification',
      );
    }

    await this.prisma.notification.delete({
      where: { id: notificationId },
    });
    return { message: 'Notification deleted successfully' };
  }
}
