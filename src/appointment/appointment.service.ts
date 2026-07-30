import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BookAppointmentDto } from './dto/book-appointment.dto';
import { RescheduleAppointmentDto } from './dto/reschedule-appointment.dto';
import { CompleteAppointmentDto } from './dto/complete-appointment.dto';
import { Prisma, AppointmentStatus } from '@prisma/client';

@Injectable()
export class AppointmentService {
  constructor(private readonly prisma: PrismaService) {}

  // Helper: Parses 24h or 12h time string to minutes from midnight
  private parseTimeToMinutes(timeStr: string): number {
    const cleaned = timeStr.trim().toUpperCase();

    // 12-hour format
    const match12 = cleaned.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
    if (match12) {
      let hours = parseInt(match12[1], 10);
      const minutes = parseInt(match12[2], 10);
      const ampm = match12[3];

      if (hours < 1 || hours > 12 || minutes < 0 || minutes > 59) {
        throw new BadRequestException('Invalid time format');
      }

      if (ampm === 'PM' && hours !== 12) {
        hours += 12;
      } else if (ampm === 'AM' && hours === 12) {
        hours = 0;
      }

      return hours * 60 + minutes;
    }

    // 24-hour format
    const match24 = cleaned.match(/^(\d{2}):(\d{2})$/);
    if (match24) {
      const hours = parseInt(match24[1], 10);
      const minutes = parseInt(match24[2], 10);

      if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
        throw new BadRequestException('Invalid time format');
      }

      return hours * 60 + minutes;
    }

    throw new BadRequestException(
      'Invalid time format. Use HH:MM or HH:MM AM/PM',
    );
  }

  // Helper: Converts minutes from midnight back to HH:MM format
  private minutesToTimeString(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  }

  // Helper: Format Date to AMPM format
  private formatToAMPM(date: Date): string {
    let hours = date.getUTCHours();
    const minutes = date.getUTCMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    const minutesStr = minutes < 10 ? '0' + minutes : minutes;
    return minutes === 0 ? `${hours}${ampm}` : `${hours}:${minutesStr}${ampm}`;
  }

  // Book appointment
  async bookAppointment(loggedInUserId: number, dto: BookAppointmentDto) {
    const docId = Number(dto.doctorId);

    if (isNaN(docId)) {
      throw new BadRequestException('Invalid doctorId');
    }

    // 1. Validate Doctor exists
    const doctorProfile = await this.prisma.doctorProfile.findUnique({
      where: { id: docId },
    });
    if (!doctorProfile) {
      throw new NotFoundException('Doctor not found');
    }

    // 2. Validate Patient exists
    const patientProfile = await this.prisma.patientProfile.findUnique({
      where: { userId: loggedInUserId },
    });
    if (!patientProfile) {
      throw new NotFoundException('Patient profile not found');
    }

    const now = Date.now();
    const bufferTimeMs = 30 * 60 * 1000; // 30 minutes booking buffer

    if (doctorProfile.schedulingType === 'STREAM') {
      let startTimeStr = dto.slotId ?? dto.slot ?? dto.startTime;
      let endTimeStr = dto.endTime;

      if (!startTimeStr) {
        throw new BadRequestException(
          'slotId, slot, or startTime is required for STREAM scheduling',
        );
      }

      if (startTimeStr.includes('-')) {
        const parts = startTimeStr.split('-');
        startTimeStr = parts[0];
        endTimeStr = parts[1];
      }

      const dateStr = dto.date ?? new Date().toISOString().split('T')[0];
      const [year, month, day] = dateStr.split('-').map(Number);
      if (isNaN(year) || isNaN(month) || isNaN(day)) {
        throw new BadRequestException('Invalid date format. Use YYYY-MM-DD');
      }

      const startMin = this.parseTimeToMinutes(startTimeStr);
      const slotDuration = doctorProfile.slotDuration;
      if (!slotDuration || slotDuration <= 0) {
        throw new BadRequestException('Invalid slot duration');
      }
      let endMin = startMin + slotDuration;
      if (endTimeStr) {
        endMin = this.parseTimeToMinutes(endTimeStr);
        if (endMin - startMin !== slotDuration) {
          throw new BadRequestException(
            'Booking duration does not match doctor slot duration',
          );
        }
      }

      const slotStartDt = new Date(
        Date.UTC(
          year,
          month - 1,
          day,
          Math.floor(startMin / 60),
          startMin % 60,
        ),
      );
      const slotEndDt = new Date(
        Date.UTC(year, month - 1, day, Math.floor(endMin / 60), endMin % 60),
      );

      // 3. Validate Date is future & booking buffer
      if (slotStartDt.getTime() < now + bufferTimeMs) {
        throw new BadRequestException(
          'Cannot book appointment in the past or within 30-minute buffer',
        );
      }

      // 4. Daily Booking Limit: max 20 appointments per day
      const startOfDay = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
      const endOfDay = new Date(
        Date.UTC(year, month - 1, day, 23, 59, 59, 999),
      );
      const dailyCount = await this.prisma.appointment.count({
        where: {
          doctorProfileId: doctorProfile.id,
          status: 'BOOKED',
          slotStart: {
            gte: startOfDay,
            lte: endOfDay,
          },
        },
      });
      if (dailyCount >= 20) {
        throw new BadRequestException(
          'Doctor is fully booked for this date (daily booking limit reached)',
        );
      }

      // 5. Duplicate Booking Check
      const duplicate = await this.prisma.appointment.findFirst({
        where: {
          doctorProfileId: doctorProfile.id,
          patientProfileId: patientProfile.id,
          slotStart: slotStartDt,
          status: 'BOOKED',
        },
      });
      if (duplicate) {
        throw new ConflictException('Duplicate booking');
      }

      // 6. Slot Booked check
      const slotBooked = await this.prisma.appointment.findFirst({
        where: {
          doctorProfileId: doctorProfile.id,
          slotStart: slotStartDt,
          slotEnd: slotEndDt,
          status: 'BOOKED',
        },
      });
      if (slotBooked) {
        throw new ConflictException('Slot already booked');
      }

      // 7. Verify slot availability window
      const overrides = await this.prisma.customAvailability.findMany({
        where: {
          doctorProfileId: doctorProfile.id,
          date: new Date(Date.UTC(year, month - 1, day)),
        },
      });

      let isAvailable = false;

      if (overrides.length > 0) {
        const unavailable = overrides.some((o) => !o.isAvailable);
        if (!unavailable) {
          for (const ov of overrides) {
            if (ov.startTime && ov.endTime) {
              const ovStart = this.parseTimeToMinutes(ov.startTime);
              const ovEnd = this.parseTimeToMinutes(ov.endTime);
              if (startMin >= ovStart && endMin <= ovEnd) {
                isAvailable = true;
                break;
              }
            }
          }
        }
      } else {
        const dayNames = [
          'SUNDAY',
          'MONDAY',
          'TUESDAY',
          'WEDNESDAY',
          'THURSDAY',
          'FRIDAY',
          'SATURDAY',
        ];
        const dayOfWeek = dayNames[slotStartDt.getUTCDay()];
        const recurring = await this.prisma.recurringAvailability.findMany({
          where: {
            doctorProfileId: doctorProfile.id,
            dayOfWeek,
          },
        });

        for (const rec of recurring) {
          const recStart = this.parseTimeToMinutes(rec.startTime);
          const recEnd = this.parseTimeToMinutes(rec.endTime);
          if (startMin >= recStart && endMin <= recEnd) {
            isAvailable = true;
            break;
          }
        }
      }

      if (!isAvailable) {
        throw new BadRequestException('Slot is not available');
      }

      // Save
      const app = await this.prisma.appointment.create({
        data: {
          doctorProfileId: doctorProfile.id,
          patientProfileId: patientProfile.id,
          appointmentType: 'STREAM',
          slotStart: slotStartDt,
          slotEnd: slotEndDt,
          status: 'BOOKED',
          bookingSource: dto.bookingSource ?? 'ONLINE',
        },
      });

      return {
        id: app.id,
        doctorId: doctorProfile.id,
        patientId: patientProfile.id,
        slotStart: app.slotStart!.toISOString(),
        slotEnd: app.slotEnd!.toISOString(),
        appointmentType: 'STREAM',
        status: app.status,
      };
    } else {
      // WAVE scheduling
      const targetWaveId = dto.slotId ?? dto.waveId;
      if (!targetWaveId) {
        throw new BadRequestException(
          'slotId or waveId is required for WAVE scheduling',
        );
      }

      const waveId = Number(targetWaveId);
      if (isNaN(waveId)) {
        throw new BadRequestException('Invalid slotId or waveId');
      }

      const waveSchedule = await this.prisma.waveSchedule.findUnique({
        where: { id: waveId },
      });

      if (!waveSchedule) {
        throw new NotFoundException('Wave schedule not found');
      }

      if (waveSchedule.doctorProfileId !== doctorProfile.id) {
        throw new BadRequestException(
          'Wave schedule does not belong to this doctor',
        );
      }

      // Past wave check + buffer
      if (waveSchedule.startTime.getTime() < now + bufferTimeMs) {
        throw new BadRequestException(
          'Cannot book appointment in the past or within 30-minute buffer',
        );
      }

      // Daily Booking Limit
      const dateObj = waveSchedule.startTime;
      const startOfDay = new Date(
        Date.UTC(
          dateObj.getUTCFullYear(),
          dateObj.getUTCMonth(),
          dateObj.getUTCDate(),
          0,
          0,
          0,
        ),
      );
      const endOfDay = new Date(
        Date.UTC(
          dateObj.getUTCFullYear(),
          dateObj.getUTCMonth(),
          dateObj.getUTCDate(),
          23,
          59,
          59,
          999,
        ),
      );
      const dailyCount = await this.prisma.appointment.count({
        where: {
          doctorProfileId: doctorProfile.id,
          status: 'BOOKED',
          slotStart: {
            gte: startOfDay,
            lte: endOfDay,
          },
        },
      });
      if (dailyCount >= 20) {
        throw new BadRequestException(
          'Doctor is fully booked for this date (daily booking limit reached)',
        );
      }

      // Check duplicate booking
      const duplicate = await this.prisma.appointment.findFirst({
        where: {
          waveScheduleId: waveSchedule.id,
          patientProfileId: patientProfile.id,
          status: 'BOOKED',
        },
      });
      if (duplicate) {
        throw new ConflictException('Duplicate booking');
      }

      // Capacity check
      const count = await this.prisma.appointment.count({
        where: { waveScheduleId: waveSchedule.id, status: 'BOOKED' },
      });

      if (count >= waveSchedule.maxCapacity) {
        throw new ConflictException('Wave Full');
      }

      const tokenNumber = count + 1;

      const app = await this.prisma.appointment.create({
        data: {
          doctorProfileId: doctorProfile.id,
          patientProfileId: patientProfile.id,
          appointmentType: 'WAVE',
          slotStart: waveSchedule.startTime,
          slotEnd: waveSchedule.endTime,
          waveScheduleId: waveSchedule.id,
          tokenNumber,
          status: 'BOOKED',
          bookingSource: dto.bookingSource ?? 'ONLINE',
        },
      });

      const startStr = this.formatToAMPM(waveSchedule.startTime);
      const endStr = this.formatToAMPM(waveSchedule.endTime);

      return {
        id: app.id,
        appointmentWindow: `${startStr}-${endStr}`,
        tokenNumber,
        status: app.status,
      };
    }
  }

  // Cancel appointment
  async cancelAppointment(
    loggedInUserId: number,
    appointmentId: number,
    reason?: string,
  ) {
    const app = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: { patientProfile: true },
    });

    if (!app) {
      throw new NotFoundException('Appointment not found');
    }

    if (app.patientProfile.userId !== loggedInUserId) {
      throw new ForbiddenException(
        'You do not have access to cancel this appointment',
      );
    }

    if (app.status !== 'BOOKED') {
      if (app.status === 'CANCELLED') {
        throw new BadRequestException('Appointment is already cancelled');
      } else {
        throw new BadRequestException(
          'Only active BOOKED appointments can be cancelled',
        );
      }
    }

    const now = Date.now();
    if (app.slotStart && app.slotStart.getTime() < now) {
      throw new BadRequestException('Past appointments cannot be cancelled');
    }

    // Cancellation window: Only allow cancellation 2 hours before appointment
    const cancellationWindowMs = 2 * 60 * 60 * 1000;
    if (app.slotStart && app.slotStart.getTime() < now + cancellationWindowMs) {
      throw new BadRequestException(
        'Appointments can only be cancelled at least 2 hours before the start time',
      );
    }

    const updated = await this.prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        status: 'CANCELLED',
        cancellationReason: reason ?? 'Cancelled by patient',
        cancelledAt: new Date(),
      },
    });

    return {
      id: updated.id,
      doctorId: updated.doctorProfileId,
      patientId: updated.patientProfileId,
      status: updated.status,
      cancellationReason: updated.cancellationReason,
      cancelledAt: updated.cancelledAt?.toISOString(),
    };
  }

  // Reschedule appointment
  async rescheduleAppointment(
    loggedInUserId: number,
    appointmentId: number,
    dto: RescheduleAppointmentDto,
  ) {
    const app = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        patientProfile: true,
        doctorProfile: true,
      },
    });

    if (!app) {
      throw new NotFoundException('Appointment not found');
    }

    if (app.patientProfile.userId !== loggedInUserId) {
      throw new ForbiddenException(
        'You do not have access to reschedule this appointment',
      );
    }

    if (app.status !== 'BOOKED') {
      throw new BadRequestException(
        'Only active BOOKED appointments can be rescheduled',
      );
    }

    const now = Date.now();
    if (app.slotStart && app.slotStart.getTime() < now) {
      throw new BadRequestException('Past appointments cannot be rescheduled');
    }

    const targetDate = dto.newDate ?? dto.date;
    const targetSlotId = dto.newSlotId ?? dto.slotId ?? dto.slot;

    if (app.appointmentType === 'STREAM') {
      if (!targetDate) {
        throw new BadRequestException('date is required');
      }
      let startTimeStr = targetSlotId ?? dto.startTime;
      let endTimeStr = dto.endTime;
      if (!startTimeStr) {
        throw new BadRequestException('slot or startTime is required');
      }

      if (startTimeStr.includes('-')) {
        const parts = startTimeStr.split('-');
        startTimeStr = parts[0];
        endTimeStr = parts[1];
      }

      const [year, month, day] = targetDate.split('-').map(Number);
      if (isNaN(year) || isNaN(month) || isNaN(day)) {
        throw new BadRequestException('Invalid date format. Use YYYY-MM-DD');
      }

      const startMin = this.parseTimeToMinutes(startTimeStr);
      const slotDuration = app.doctorProfile.slotDuration;
      if (!slotDuration || slotDuration <= 0) {
        throw new BadRequestException('Invalid slot duration');
      }
      let endMin = startMin + slotDuration;
      if (endTimeStr) {
        endMin = this.parseTimeToMinutes(endTimeStr);
        if (endMin - startMin !== slotDuration) {
          throw new BadRequestException(
            'Booking duration does not match doctor slot duration',
          );
        }
      }

      const slotStartDt = new Date(
        Date.UTC(
          year,
          month - 1,
          day,
          Math.floor(startMin / 60),
          startMin % 60,
        ),
      );
      const slotEndDt = new Date(
        Date.UTC(year, month - 1, day, Math.floor(endMin / 60), endMin % 60),
      );

      // Same date & time check
      if (
        app.slotStart &&
        app.slotStart.getTime() === slotStartDt.getTime() &&
        app.slotEnd &&
        app.slotEnd.getTime() === slotEndDt.getTime()
      ) {
        throw new BadRequestException(
          'Appointment is already scheduled for this date and time',
        );
      }

      // Future check + 30-minute buffer
      const bufferTimeMs = 30 * 60 * 1000;
      if (slotStartDt.getTime() < now + bufferTimeMs) {
        throw new BadRequestException(
          'Cannot reschedule to the past or within 30-minute buffer',
        );
      }

      // Daily Booking Limit check for target date
      const startOfDay = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
      const endOfDay = new Date(
        Date.UTC(year, month - 1, day, 23, 59, 59, 999),
      );
      const dailyCount = await this.prisma.appointment.count({
        where: {
          doctorProfileId: app.doctorProfile.id,
          status: 'BOOKED',
          slotStart: {
            gte: startOfDay,
            lte: endOfDay,
          },
          id: { not: appointmentId },
        },
      });
      if (dailyCount >= 20) {
        throw new BadRequestException(
          'Doctor is fully booked for this date (daily booking limit reached)',
        );
      }

      // Availability check
      let isAvailable = false;
      const overrides = await this.prisma.customAvailability.findMany({
        where: {
          doctorProfileId: app.doctorProfile.id,
          date: new Date(Date.UTC(year, month - 1, day)),
        },
      });

      if (overrides.length > 0) {
        const unavailable = overrides.some((o) => !o.isAvailable);
        if (!unavailable) {
          for (const ov of overrides) {
            if (ov.startTime && ov.endTime) {
              const ovStart = this.parseTimeToMinutes(ov.startTime);
              const ovEnd = this.parseTimeToMinutes(ov.endTime);
              if (startMin >= ovStart && endMin <= ovEnd) {
                isAvailable = true;
                break;
              }
            }
          }
        }
      } else {
        const dayNames = [
          'SUNDAY',
          'MONDAY',
          'TUESDAY',
          'WEDNESDAY',
          'THURSDAY',
          'FRIDAY',
          'SATURDAY',
        ];
        const dayOfWeek = dayNames[slotStartDt.getUTCDay()];
        const recurring = await this.prisma.recurringAvailability.findMany({
          where: {
            doctorProfileId: app.doctorProfile.id,
            dayOfWeek,
          },
        });

        for (const rec of recurring) {
          const recStart = this.parseTimeToMinutes(rec.startTime);
          const recEnd = this.parseTimeToMinutes(rec.endTime);
          if (startMin >= recStart && endMin <= recEnd) {
            isAvailable = true;
            break;
          }
        }
      }

      if (!isAvailable) {
        throw new BadRequestException('Slot is not available');
      }

      // Check double-booking
      const slotBooked = await this.prisma.appointment.findFirst({
        where: {
          doctorProfileId: app.doctorProfile.id,
          slotStart: slotStartDt,
          slotEnd: slotEndDt,
          status: 'BOOKED',
          id: { not: appointmentId },
        },
      });
      if (slotBooked) {
        throw new ConflictException('Target slot is already booked');
      }

      const updated = await this.prisma.appointment.update({
        where: { id: appointmentId },
        data: {
          slotStart: slotStartDt,
          slotEnd: slotEndDt,
        },
      });

      return {
        id: updated.id,
        doctorId: app.doctorProfile.id,
        patientId: app.patientProfile.id,
        slotStart: updated.slotStart!.toISOString(),
        slotEnd: updated.slotEnd!.toISOString(),
        appointmentType: 'STREAM',
        status: updated.status,
      };
    } else {
      // WAVE scheduling rescheduling
      const targetWaveId = targetSlotId ?? dto.waveId;
      if (!targetWaveId) {
        throw new BadRequestException(
          'slotId or waveId is required for WAVE rescheduling',
        );
      }

      const waveId = Number(targetWaveId);
      if (isNaN(waveId)) {
        throw new BadRequestException('Invalid slotId or waveId');
      }

      const waveSchedule = await this.prisma.waveSchedule.findUnique({
        where: { id: waveId },
      });

      if (!waveSchedule) {
        throw new NotFoundException('Wave schedule not found');
      }

      if (waveSchedule.doctorProfileId !== app.doctorProfile.id) {
        throw new BadRequestException(
          'Wave schedule does not belong to this doctor',
        );
      }

      // Same wave check
      if (app.waveScheduleId === waveSchedule.id) {
        throw new BadRequestException(
          'Appointment is already scheduled for this wave',
        );
      }

      // Future check + 30-minute buffer
      const bufferTimeMs = 30 * 60 * 1000;
      if (waveSchedule.startTime.getTime() < now + bufferTimeMs) {
        throw new BadRequestException(
          'Cannot reschedule to the past or within 30-minute buffer',
        );
      }

      // Daily limit check on target date
      const dateObj = waveSchedule.startTime;
      const startOfDay = new Date(
        Date.UTC(
          dateObj.getUTCFullYear(),
          dateObj.getUTCMonth(),
          dateObj.getUTCDate(),
          0,
          0,
          0,
        ),
      );
      const endOfDay = new Date(
        Date.UTC(
          dateObj.getUTCFullYear(),
          dateObj.getUTCMonth(),
          dateObj.getUTCDate(),
          23,
          59,
          59,
          999,
        ),
      );
      const dailyCount = await this.prisma.appointment.count({
        where: {
          doctorProfileId: app.doctorProfile.id,
          status: 'BOOKED',
          slotStart: {
            gte: startOfDay,
            lte: endOfDay,
          },
          id: { not: appointmentId },
        },
      });
      if (dailyCount >= 20) {
        throw new BadRequestException(
          'Doctor is fully booked for this date (daily booking limit reached)',
        );
      }

      // Capacity check
      const count = await this.prisma.appointment.count({
        where: { waveScheduleId: waveSchedule.id, status: 'BOOKED' },
      });

      if (count >= waveSchedule.maxCapacity) {
        throw new ConflictException('Wave Full');
      }

      const tokenNumber = count + 1;

      const updated = await this.prisma.appointment.update({
        where: { id: appointmentId },
        data: {
          slotStart: waveSchedule.startTime,
          slotEnd: waveSchedule.endTime,
          waveScheduleId: waveSchedule.id,
          tokenNumber,
        },
      });

      const startStr = this.formatToAMPM(waveSchedule.startTime);
      const endStr = this.formatToAMPM(waveSchedule.endTime);

      return {
        id: updated.id,
        doctorId: app.doctorProfile.id,
        patientId: app.patientProfile.id,
        appointmentWindow: `${startStr}-${endStr}`,
        tokenNumber,
        appointmentType: 'WAVE',
        status: updated.status,
      };
    }
  }

  // Get patient's appointments
  async getMyAppointments(
    loggedInUserId: number,
    query?: { history?: boolean; upcoming?: boolean },
  ) {
    const patientProfile = await this.prisma.patientProfile.findUnique({
      where: { userId: loggedInUserId },
    });
    if (!patientProfile) {
      throw new NotFoundException('Patient profile not found');
    }

    const whereClause: Prisma.AppointmentWhereInput = {
      patientProfileId: patientProfile.id,
    };

    if (query?.history) {
      whereClause.status = { in: ['CANCELLED', 'COMPLETED', 'NO_SHOW'] };
    } else if (query?.upcoming) {
      whereClause.status = 'BOOKED';
      whereClause.slotStart = { gte: new Date() };
    }

    const appointments = await this.prisma.appointment.findMany({
      where: whereClause,
      include: { doctorProfile: true },
      orderBy: { slotStart: 'asc' },
    });

    return appointments.map((app) => {
      const isWave = app.appointmentType === 'WAVE';
      return {
        id: app.id,
        doctor: {
          id: app.doctorProfile.id,
          fullName: app.doctorProfile.fullName,
          specialization: app.doctorProfile.specialization,
          consultationFee: app.doctorProfile.consultationFee,
        },
        date: app.slotStart ? app.slotStart.toISOString().split('T')[0] : null,
        startTime: app.slotStart ? this.formatToAMPM(app.slotStart) : null,
        endTime: app.slotEnd ? this.formatToAMPM(app.slotEnd) : null,
        appointmentWindow:
          isWave && app.slotStart && app.slotEnd
            ? `${this.formatToAMPM(app.slotStart)}-${this.formatToAMPM(app.slotEnd)}`
            : null,
        tokenNumber: app.tokenNumber,
        status: app.status,
        appointmentType: app.appointmentType,
        diagnosis: app.diagnosis,
        prescription: app.prescription,
        followUp: app.followUp,
        createdAt: app.createdAt.toISOString(),
      };
    });
  }

  // Get doctor's appointments
  async getDoctorAppointments(
    loggedInUserId: number,
    query: {
      date?: string;
      status?: string;
      page?: number;
      limit?: number;
      sort?: string;
    },
  ) {
    const doctorProfile = await this.prisma.doctorProfile.findUnique({
      where: { userId: loggedInUserId },
    });
    if (!doctorProfile) {
      throw new NotFoundException('Doctor profile not found');
    }

    const whereClause: Prisma.AppointmentWhereInput = {
      doctorProfileId: doctorProfile.id,
    };

    if (query.date) {
      const [year, month, day] = query.date.split('-').map(Number);
      if (!isNaN(year) && !isNaN(month) && !isNaN(day)) {
        const startOfDay = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
        const endOfDay = new Date(
          Date.UTC(year, month - 1, day, 23, 59, 59, 999),
        );
        whereClause.slotStart = {
          gte: startOfDay,
          lte: endOfDay,
        };
      }
    }

    if (query.status) {
      whereClause.status = query.status as AppointmentStatus;
    }

    const page = Number(query.page ?? 1);
    const limit = Number(query.limit ?? 10);
    const skip = (page - 1) * limit;

    let orderBy: Prisma.AppointmentOrderByWithRelationInput = {
      slotStart: 'asc',
    };
    if (query.sort) {
      if (query.sort === 'date') {
        orderBy = { slotStart: 'asc' };
      } else if (query.sort === '-date') {
        orderBy = { slotStart: 'desc' };
      }
    }

    const appointments = await this.prisma.appointment.findMany({
      where: whereClause,
      include: { patientProfile: true },
      skip,
      take: limit,
      orderBy,
    });

    const total = await this.prisma.appointment.count({ where: whereClause });

    const data = appointments.map((app) => ({
      id: app.id,
      patient: {
        id: app.patientProfile.id,
        fullName: app.patientProfile.fullName,
        age: app.patientProfile.age,
        gender: app.patientProfile.gender,
        contact: app.patientProfile.contact,
        healthInfo: app.patientProfile.healthInfo,
      },
      date: app.slotStart ? app.slotStart.toISOString().split('T')[0] : null,
      startTime: app.slotStart ? this.formatToAMPM(app.slotStart) : null,
      endTime: app.slotEnd ? this.formatToAMPM(app.slotEnd) : null,
      appointmentWindow:
        app.appointmentType === 'WAVE' && app.slotStart && app.slotEnd
          ? `${this.formatToAMPM(app.slotStart)}-${this.formatToAMPM(app.slotEnd)}`
          : null,
      tokenNumber: app.tokenNumber,
      status: app.status,
      appointmentType: app.appointmentType,
      bookingSource: app.bookingSource,
      diagnosis: app.diagnosis,
      prescription: app.prescription,
      followUp: app.followUp,
      createdAt: app.createdAt.toISOString(),
    }));

    return {
      appointments: data,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // Complete appointment (Doctor adds medical notes)
  async completeAppointment(
    loggedInUserId: number,
    appointmentId: number,
    dto: CompleteAppointmentDto,
  ) {
    const doctorProfile = await this.prisma.doctorProfile.findUnique({
      where: { userId: loggedInUserId },
    });
    if (!doctorProfile) {
      throw new NotFoundException('Doctor profile not found');
    }

    const app = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
    });

    if (!app) {
      throw new NotFoundException('Appointment not found');
    }

    if (app.doctorProfileId !== doctorProfile.id) {
      throw new ForbiddenException(
        'You do not have access to complete this appointment',
      );
    }

    if (app.status !== 'BOOKED') {
      throw new BadRequestException(
        'Only active BOOKED appointments can be completed',
      );
    }

    const updated = await this.prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        status: 'COMPLETED',
        diagnosis: dto.diagnosis,
        prescription: dto.prescription,
        followUp: dto.followUp ?? null,
      },
    });

    return {
      id: updated.id,
      doctorId: updated.doctorProfileId,
      patientId: updated.patientProfileId,
      status: updated.status,
      diagnosis: updated.diagnosis,
      prescription: updated.prescription,
      followUp: updated.followUp,
    };
  }

  // Get appointment details (legacy/compatibility method)
  async getAppointmentDetails(loggedInUserId: number, appointmentId: number) {
    const app = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        doctorProfile: true,
        patientProfile: true,
      },
    });

    if (!app) {
      throw new NotFoundException('Appointment not found');
    }

    const isDoctor = app.doctorProfile.userId === loggedInUserId;
    const isPatient = app.patientProfile.userId === loggedInUserId;
    if (!isDoctor && !isPatient) {
      throw new ConflictException('Access denied to appointment details');
    }

    if (app.appointmentType === 'WAVE') {
      const startStr = this.formatToAMPM(app.slotStart!);
      const endStr = this.formatToAMPM(app.slotEnd!);
      return {
        id: app.id,
        doctorId: app.doctorProfileId,
        patientId: app.patientProfileId,
        appointmentType: 'WAVE',
        appointmentWindow: `${startStr}-${endStr}`,
        tokenNumber: app.tokenNumber,
        status: app.status,
        diagnosis: app.diagnosis,
        prescription: app.prescription,
        followUp: app.followUp,
        createdAt: app.createdAt.toISOString(),
      };
    } else {
      return {
        id: app.id,
        doctorId: app.doctorProfileId,
        patientId: app.patientProfileId,
        appointmentType: 'STREAM',
        slotStart: app.slotStart!.toISOString(),
        slotEnd: app.slotEnd!.toISOString(),
        status: app.status,
        diagnosis: app.diagnosis,
        prescription: app.prescription,
        followUp: app.followUp,
        createdAt: app.createdAt.toISOString(),
      };
    }
  }
}
