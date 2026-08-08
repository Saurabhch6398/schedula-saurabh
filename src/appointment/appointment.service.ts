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

  // Helper: Find next available appointment slot or wave
  async suggestNextAvailable(
    doctorId: number,
    dateStr: string,
    type: 'STREAM' | 'WAVE',
    afterTimeStr?: string,
    tx?: Prisma.TransactionClient,
  ): Promise<any> {
    const client = tx || this.prisma;
    const doctorProfile = await client.doctorProfile.findUnique({
      where: { id: doctorId },
    });
    if (!doctorProfile) return null;

    const slotDuration = doctorProfile.slotDuration ?? 15;
    const bufferTime = doctorProfile.bufferTime ?? 0;

    const [year, month, day] = dateStr.split('-').map(Number);
    if (isNaN(year) || isNaN(month) || isNaN(day)) return null;

    const now = Date.now();
    const bufferTimeMs = 30 * 60 * 1000; // 30 minutes booking buffer

    let checkDate = new Date(Date.UTC(year, month - 1, day));

    // Try finding an available slot/wave day by day, up to 30 days
    for (let i = 0; i < 30; i++) {
      const currentCheckingDateStr = checkDate.toISOString().split('T')[0];
      const checkYear = checkDate.getUTCFullYear();
      const checkMonth = checkDate.getUTCMonth();
      const checkDay = checkDate.getUTCDate();

      if (type === 'STREAM') {
        // 1. Check custom overrides
        const overrides = await client.customAvailability.findMany({
          where: {
            doctorProfileId: doctorId,
            date: new Date(Date.UTC(checkYear, checkMonth, checkDay)),
          },
        });

        let availabilities: { startTime?: string; endTime?: string; isAvailable: boolean }[] = [];
        let isOverridden = false;

        if (overrides.length > 0) {
          isOverridden = true;
          const unavailable = overrides.some((o) => !o.isAvailable);
          if (!unavailable) {
            availabilities = overrides.map((o) => ({
              startTime: o.startTime ?? undefined,
              endTime: o.endTime ?? undefined,
              isAvailable: o.isAvailable,
            }));
          }
        }

        // 2. Fall back to recurring if no override
        if (!isOverridden) {
          const dayNames = [
            'SUNDAY',
            'MONDAY',
            'TUESDAY',
            'WEDNESDAY',
            'THURSDAY',
            'FRIDAY',
            'SATURDAY',
          ];
          const dayOfWeek = dayNames[checkDate.getUTCDay()];
          const recurring = await client.recurringAvailability.findMany({
            where: {
              doctorProfileId: doctorId,
              dayOfWeek,
            },
          });
          availabilities = recurring.map((r) => ({
            startTime: r.startTime,
            endTime: r.endTime,
            isAvailable: true,
          }));
        }

        // Fetch existing bookings for this doctor on checkDate
        const startOfDay = new Date(Date.UTC(checkYear, checkMonth, checkDay, 0, 0, 0));
        const endOfDay = new Date(Date.UTC(checkYear, checkMonth, checkDay, 23, 59, 59, 999));
        const bookings = await client.appointment.findMany({
          where: {
            doctorProfileId: doctorId,
            appointmentType: 'STREAM',
            slotStart: {
              gte: startOfDay,
              lte: endOfDay,
            },
            status: 'BOOKED',
          },
        });

        const availableSlots: { slot: string; start: string; end: string; startTimeMin: number }[] = [];

        for (const avail of availabilities) {
          if (!avail.startTime || !avail.endTime) continue;

          const startMin = this.parseTimeToMinutes(avail.startTime);
          const endMin = this.parseTimeToMinutes(avail.endTime);

          let current = startMin;
          while (current + slotDuration <= endMin) {
            const slotStartMin = current;
            const slotEndMin = current + slotDuration;

            const slotStartDt = new Date(
              Date.UTC(checkYear, checkMonth, checkDay, Math.floor(slotStartMin / 60), slotStartMin % 60),
            );

            // Must be at least 30 mins in the future
            if (slotStartDt.getTime() >= now + bufferTimeMs) {
              // Check if after requested time on the original date
              let afterCheck = true;
              if (i === 0 && afterTimeStr) {
                const requestedMin = this.parseTimeToMinutes(afterTimeStr);
                if (slotStartMin <= requestedMin) {
                  afterCheck = false;
                }
              }

              if (afterCheck) {
                const isBooked = bookings.some((app) => {
                  if (!app.slotStart || !app.slotEnd) return false;
                  const appStartMin = app.slotStart.getUTCHours() * 60 + app.slotStart.getUTCMinutes();
                  const appEndMin = app.slotEnd.getUTCHours() * 60 + app.slotEnd.getUTCMinutes();
                  return appStartMin === slotStartMin && appEndMin === slotEndMin;
                });

                if (!isBooked) {
                  const slotStartStr = this.minutesToTimeString(slotStartMin);
                  const slotEndStr = this.minutesToTimeString(slotEndMin);
                  availableSlots.push({
                    slot: `${slotStartStr}-${slotEndStr}`,
                    start: slotStartStr,
                    end: slotEndStr,
                    startTimeMin: slotStartMin,
                  });
                }
              }
            }
            current += slotDuration + bufferTime;
          }
        }

        if (availableSlots.length > 0) {
          availableSlots.sort((a, b) => a.startTimeMin - b.startTimeMin);
          return {
            date: currentCheckingDateStr,
            slot: availableSlots[0].slot,
            startTime: availableSlots[0].start,
            endTime: availableSlots[0].end,
          };
        }
      } else {
        // WAVE scheduling
        const startOfDay = new Date(Date.UTC(checkYear, checkMonth, checkDay, 0, 0, 0));
        const endOfDay = new Date(Date.UTC(checkYear, checkMonth, checkDay, 23, 59, 59, 999));

        const waves = await client.waveSchedule.findMany({
          where: {
            doctorProfileId: doctorId,
            startTime: {
              gte: startOfDay,
              lte: endOfDay,
            },
          },
          orderBy: { startTime: 'asc' },
        });

        for (const wave of waves) {
          // Must start at least 30 minutes in the future
          if (wave.startTime.getTime() >= now + bufferTimeMs) {
            // Count booked appointments
            const bookedCount = await client.appointment.count({
              where: {
                waveScheduleId: wave.id,
                status: 'BOOKED',
              },
            });

            if (bookedCount < wave.maxCapacity) {
              const startStr = this.formatToAMPM(wave.startTime);
              const endStr = this.formatToAMPM(wave.endTime);
              return {
                date: currentCheckingDateStr,
                waveId: wave.id,
                startTime: startStr,
                endTime: endStr,
                window: `${startStr}-${endStr}`,
              };
            }
          }
        }
      }

      // Move to next day
      checkDate.setUTCDate(checkDate.getUTCDate() + 1);
    }

    return null;
  }

  // Book appointment
  async bookAppointment(loggedInUserId: number, dto: BookAppointmentDto) {
    const docId = Number(dto.doctorId);

    if (isNaN(docId)) {
      throw new BadRequestException('Invalid doctorId');
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Validate Doctor exists & Lock doctor profile to serialize booking operations
      await tx.$queryRaw`SELECT id FROM doctor_profiles WHERE id = ${docId} FOR UPDATE`;

      const doctorProfile = await tx.doctorProfile.findUnique({
        where: { id: docId },
      });
      if (!doctorProfile) {
        throw new NotFoundException('Doctor not found');
      }

      // 2. Validate Patient exists
      const patientProfile = await tx.patientProfile.findUnique({
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
        const dailyCount = await tx.appointment.count({
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
          const nextAvail = await this.suggestNextAvailable(doctorProfile.id, dateStr, 'STREAM', startTimeStr);
          throw new BadRequestException({
            message: 'Doctor is fully booked for this date (daily booking limit reached)',
            nextAvailable: nextAvail,
          });
        }

        // 5. Duplicate Booking Check
        const duplicate = await tx.appointment.findFirst({
          where: {
            doctorProfileId: doctorProfile.id,
            patientProfileId: patientProfile.id,
            slotStart: slotStartDt,
            status: 'BOOKED',
          },
        });
        if (duplicate) {
          const nextAvail = await this.suggestNextAvailable(doctorProfile.id, dateStr, 'STREAM', startTimeStr);
          throw new ConflictException({
            message: 'Duplicate booking',
            nextAvailable: nextAvail,
          });
        }

        // 6. Slot Booked check
        const slotBooked = await tx.appointment.findFirst({
          where: {
            doctorProfileId: doctorProfile.id,
            slotStart: slotStartDt,
            slotEnd: slotEndDt,
            status: 'BOOKED',
          },
        });
        if (slotBooked) {
          const nextAvail = await this.suggestNextAvailable(doctorProfile.id, dateStr, 'STREAM', startTimeStr);
          throw new ConflictException({
            message: 'Slot already booked',
            nextAvailable: nextAvail,
          });
        }

        // 7. Verify slot availability window
        const overrides = await tx.customAvailability.findMany({
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
          const recurring = await tx.recurringAvailability.findMany({
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
          const nextAvail = await this.suggestNextAvailable(doctorProfile.id, dateStr, 'STREAM', startTimeStr);
          throw new BadRequestException({
            message: 'Slot is not available',
            nextAvailable: nextAvail,
          });
        }

        // Save
        const app = await tx.appointment.create({
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

        const waveSchedule = await tx.waveSchedule.findUnique({
          where: { id: waveId },
        });

        if (!waveSchedule) {
          const nextAvail = await this.suggestNextAvailable(doctorProfile.id, dto.date || new Date().toISOString().split('T')[0], 'WAVE');
          throw new NotFoundException({
            message: 'Wave schedule not found',
            nextAvailable: nextAvail,
          });
        }

        if (waveSchedule.doctorProfileId !== doctorProfile.id) {
          const nextAvail = await this.suggestNextAvailable(doctorProfile.id, waveSchedule.startTime.toISOString().split('T')[0], 'WAVE');
          throw new BadRequestException({
            message: 'Wave schedule does not belong to this doctor',
            nextAvailable: nextAvail,
          });
        }

        // Lock wave schedule row to serialize concurrent wave bookings/rescheduling
        await tx.$queryRaw`SELECT id FROM wave_schedules WHERE id = ${waveSchedule.id} FOR UPDATE`;

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
        const dailyCount = await tx.appointment.count({
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
          const nextAvail = await this.suggestNextAvailable(doctorProfile.id, waveSchedule.startTime.toISOString().split('T')[0], 'WAVE');
          throw new BadRequestException({
            message: 'Doctor is fully booked for this date (daily booking limit reached)',
            nextAvailable: nextAvail,
          });
        }

        // Check duplicate booking
        const duplicate = await tx.appointment.findFirst({
          where: {
            waveScheduleId: waveSchedule.id,
            patientProfileId: patientProfile.id,
            status: 'BOOKED',
          },
        });
        if (duplicate) {
          const nextAvail = await this.suggestNextAvailable(doctorProfile.id, waveSchedule.startTime.toISOString().split('T')[0], 'WAVE');
          throw new ConflictException({
            message: 'Duplicate booking',
            nextAvailable: nextAvail,
          });
        }

        // Capacity check
        const count = await tx.appointment.count({
          where: { waveScheduleId: waveSchedule.id, status: 'BOOKED' },
        });

        if (count >= waveSchedule.maxCapacity) {
          const nextAvail = await this.suggestNextAvailable(doctorProfile.id, waveSchedule.startTime.toISOString().split('T')[0], 'WAVE');
          throw new ConflictException({
            message: 'Wave Full',
            nextAvailable: nextAvail,
          });
        }

        const tokenNumber = count + 1;

        const app = await tx.appointment.create({
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
    });
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

    // Cancellation window: Only allow cancellation 30 minutes before appointment
    const cancellationWindowMs = 30 * 60 * 1000;
    if (app.slotStart && app.slotStart.getTime() < now + cancellationWindowMs) {
      throw new BadRequestException(
        'Appointments can only be cancelled at least 30 minutes before the start time',
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
    const cutoffTimeMs = 30 * 60 * 1000;
    if (app.slotStart && app.slotStart.getTime() < now + cutoffTimeMs) {
      throw new BadRequestException(
        'Appointments can only be rescheduled at least 30 minutes before the start time',
      );
    }

    const targetDate = dto.newDate ?? dto.date;
    const targetSlotId = dto.newSlotId ?? dto.slotId ?? dto.slot;

    return this.prisma.$transaction(async (tx) => {
      // 1. Lock doctor profile to serialize updates for the doctor
      await tx.$queryRaw`SELECT id FROM doctor_profiles WHERE id = ${app.doctorProfileId} FOR UPDATE`;

      const doctorProfile = await tx.doctorProfile.findUnique({
        where: { id: app.doctorProfileId },
      });
      if (!doctorProfile) {
        throw new NotFoundException('Doctor not found');
      }

      if (doctorProfile.schedulingType === 'STREAM') {
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

        // Same date & time check
        if (
          app.appointmentType === 'STREAM' &&
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

        // Daily Booking Limit check for target date (excluding this appointment)
        const startOfDay = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
        const endOfDay = new Date(
          Date.UTC(year, month - 1, day, 23, 59, 59, 999),
        );
        const dailyCount = await tx.appointment.count({
          where: {
            doctorProfileId: doctorProfile.id,
            status: 'BOOKED',
            slotStart: {
              gte: startOfDay,
              lte: endOfDay,
            },
            id: { not: appointmentId },
          },
        });
        if (dailyCount >= 20) {
          const nextAvail = await this.suggestNextAvailable(doctorProfile.id, targetDate, 'STREAM', startTimeStr);
          throw new BadRequestException({
            message: 'Doctor is fully booked for this date (daily booking limit reached)',
            nextAvailable: nextAvail,
          });
        }

        // Availability check
        let isAvailable = false;
        const overrides = await tx.customAvailability.findMany({
          where: {
            doctorProfileId: doctorProfile.id,
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
          const recurring = await tx.recurringAvailability.findMany({
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
          const nextAvail = await this.suggestNextAvailable(doctorProfile.id, targetDate, 'STREAM', startTimeStr);
          throw new BadRequestException({
            message: 'Slot is not available',
            nextAvailable: nextAvail,
          });
        }

        // Check double-booking
        const slotBooked = await tx.appointment.findFirst({
          where: {
            doctorProfileId: doctorProfile.id,
            slotStart: slotStartDt,
            slotEnd: slotEndDt,
            status: 'BOOKED',
            id: { not: appointmentId },
          },
        });
        if (slotBooked) {
          const nextAvail = await this.suggestNextAvailable(doctorProfile.id, targetDate, 'STREAM', startTimeStr);
          throw new ConflictException({
            message: 'Target slot is already booked',
            nextAvailable: nextAvail,
          });
        }

        const updated = await tx.appointment.update({
          where: { id: appointmentId },
          data: {
            slotStart: slotStartDt,
            slotEnd: slotEndDt,
            appointmentType: 'STREAM',
            waveScheduleId: null,
            tokenNumber: null,
          },
        });

        return {
          id: updated.id,
          doctorId: doctorProfile.id,
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

        const waveSchedule = await tx.waveSchedule.findUnique({
          where: { id: waveId },
        });

        if (!waveSchedule) {
          const nextAvail = await this.suggestNextAvailable(doctorProfile.id, new Date().toISOString().split('T')[0], 'WAVE');
          throw new NotFoundException({
            message: 'Wave schedule not found',
            nextAvailable: nextAvail,
          });
        }

        if (waveSchedule.doctorProfileId !== doctorProfile.id) {
          const nextAvail = await this.suggestNextAvailable(doctorProfile.id, waveSchedule.startTime.toISOString().split('T')[0], 'WAVE');
          throw new BadRequestException({
            message: 'Wave schedule does not belong to this doctor',
            nextAvailable: nextAvail,
          });
        }

        // Same wave check
        if (app.appointmentType === 'WAVE' && app.waveScheduleId === waveSchedule.id) {
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

        // Lock wave schedule row to serialize wave bookings/rescheduling
        await tx.$queryRaw`SELECT id FROM wave_schedules WHERE id = ${waveSchedule.id} FOR UPDATE`;

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
        const dailyCount = await tx.appointment.count({
          where: {
            doctorProfileId: doctorProfile.id,
            status: 'BOOKED',
            slotStart: {
              gte: startOfDay,
              lte: endOfDay,
            },
            id: { not: appointmentId },
          },
        });
        if (dailyCount >= 20) {
          const nextAvail = await this.suggestNextAvailable(doctorProfile.id, waveSchedule.startTime.toISOString().split('T')[0], 'WAVE');
          throw new BadRequestException({
            message: 'Doctor is fully booked for this date (daily booking limit reached)',
            nextAvailable: nextAvail,
          });
        }

        // Check duplicate booking in the target wave schedule
        const duplicate = await tx.appointment.findFirst({
          where: {
            waveScheduleId: waveSchedule.id,
            patientProfileId: app.patientProfileId,
            status: 'BOOKED',
            id: { not: appointmentId },
          },
        });
        if (duplicate) {
          const nextAvail = await this.suggestNextAvailable(doctorProfile.id, waveSchedule.startTime.toISOString().split('T')[0], 'WAVE');
          throw new ConflictException({
            message: 'Duplicate booking',
            nextAvailable: nextAvail,
          });
        }

        // Capacity check
        const count = await tx.appointment.count({
          where: { waveScheduleId: waveSchedule.id, status: 'BOOKED' },
        });

        if (count >= waveSchedule.maxCapacity) {
          const nextAvail = await this.suggestNextAvailable(doctorProfile.id, waveSchedule.startTime.toISOString().split('T')[0], 'WAVE');
          throw new ConflictException({
            message: 'Wave Full',
            nextAvailable: nextAvail,
          });
        }

        const tokenNumber = count + 1;

        const updated = await tx.appointment.update({
          where: { id: appointmentId },
          data: {
            slotStart: waveSchedule.startTime,
            slotEnd: waveSchedule.endTime,
            appointmentType: 'WAVE',
            waveScheduleId: waveSchedule.id,
            tokenNumber,
          },
        });

        const startStr = this.formatToAMPM(waveSchedule.startTime);
        const endStr = this.formatToAMPM(waveSchedule.endTime);

        return {
          id: updated.id,
          doctorId: doctorProfile.id,
          patientId: app.patientProfile.id,
          appointmentWindow: `${startStr}-${endStr}`,
          tokenNumber,
          appointmentType: 'WAVE',
          status: updated.status,
        };
      }
    });
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

  // Accept Reschedule
  async acceptReschedule(patientUserId: number, appointmentId: number) {
    const app = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: { patientProfile: true },
    });

    if (!app) {
      throw new NotFoundException('Appointment not found');
    }

    if (app.patientProfile.userId !== patientUserId) {
      throw new ForbiddenException('You do not have access to this appointment');
    }

    if (!app.isRescheduled || app.rescheduleAccepted !== null) {
      throw new BadRequestException('No pending reschedule for this appointment');
    }

    const updated = await this.prisma.appointment.update({
      where: { id: appointmentId },
      data: { rescheduleAccepted: true },
    });

    const queueEntry = await this.prisma.appointmentQueue.findFirst({
      where: {
        appointmentId,
        queueType: 'RESCHEDULE',
        status: 'OFFERED',
      },
      orderBy: { createdAt: 'desc' },
    });

    if (queueEntry) {
      await this.prisma.appointmentQueue.update({
        where: { id: queueEntry.id },
        data: { status: 'ACCEPTED' },
      });
    }

    return updated;
  }

  // Reject Reschedule
  async rejectReschedule(patientUserId: number, appointmentId: number) {
    const app = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: { patientProfile: true },
    });

    if (!app) {
      throw new NotFoundException('Appointment not found');
    }

    if (app.patientProfile.userId !== patientUserId) {
      throw new ForbiddenException('You do not have access to this appointment');
    }

    if (!app.isRescheduled || app.rescheduleAccepted !== null) {
      throw new BadRequestException('No pending reschedule for this appointment');
    }

    const updated = await this.prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        rescheduleAccepted: false,
        status: 'CANCELLED',
        cancellationReason: 'Patient rejected automatic reschedule',
        cancelledAt: new Date(),
      },
    });

    const queueEntry = await this.prisma.appointmentQueue.findFirst({
      where: {
        appointmentId,
        queueType: 'RESCHEDULE',
        status: 'OFFERED',
      },
      orderBy: { createdAt: 'desc' },
    });

    if (queueEntry) {
      await this.prisma.appointmentQueue.update({
        where: { id: queueEntry.id },
        data: { status: 'REJECTED' },
      });
    }

    // Keep/Place in waitlist/ready queue for rescheduling later
    await this.prisma.appointmentQueue.create({
      data: {
        doctorProfileId: app.doctorProfileId,
        patientProfileId: app.patientProfileId,
        appointmentId: app.id,
        queueType: 'READY',
        status: 'PENDING',
      },
    });

    return updated;
  }

  // Join waitlist
  async joinWaitlist(patientUserId: number, doctorId: number) {
    const patientProfile = await this.prisma.patientProfile.findUnique({
      where: { userId: patientUserId },
    });

    if (!patientProfile) {
      throw new NotFoundException('Patient profile not found');
    }

    const doctorProfile = await this.prisma.doctorProfile.findUnique({
      where: { id: doctorId },
    });

    if (!doctorProfile) {
      throw new NotFoundException('Doctor profile not found');
    }

    const queueEntry = await this.prisma.appointmentQueue.create({
      data: {
        doctorProfileId: doctorId,
        patientProfileId: patientProfile.id,
        queueType: 'READY',
        status: 'PENDING',
      },
    });

    return queueEntry;
  }

  // Accept waitlist offer
  async acceptWaitlistOffer(patientUserId: number, queueId: number) {
    const queueEntry = await this.prisma.appointmentQueue.findUnique({
      where: { id: queueId },
      include: { patientProfile: true },
    });

    if (!queueEntry) {
      throw new NotFoundException('Queue entry not found');
    }

    if (queueEntry.patientProfile.userId !== patientUserId) {
      throw new ForbiddenException('You do not have access to this waitlist entry');
    }

    if (queueEntry.status !== 'OFFERED') {
      throw new BadRequestException('No active offer for this waitlist entry');
    }

    return this.prisma.$transaction(async (tx) => {
      let newApp;
      if (queueEntry.offeredSlotStart && queueEntry.offeredSlotEnd) {
        newApp = await tx.appointment.create({
          data: {
            doctorProfileId: queueEntry.doctorProfileId,
            patientProfileId: queueEntry.patientProfileId,
            appointmentType: 'STREAM',
            slotStart: queueEntry.offeredSlotStart,
            slotEnd: queueEntry.offeredSlotEnd,
            status: 'BOOKED',
          },
        });
      } else if (queueEntry.offeredWaveScheduleId) {
        const count = await tx.appointment.count({
          where: { waveScheduleId: queueEntry.offeredWaveScheduleId, status: 'BOOKED' },
        });

        newApp = await tx.appointment.create({
          data: {
            doctorProfileId: queueEntry.doctorProfileId,
            patientProfileId: queueEntry.patientProfileId,
            appointmentType: 'WAVE',
            waveScheduleId: queueEntry.offeredWaveScheduleId,
            tokenNumber: count + 1,
            status: 'BOOKED',
          },
        });
      } else {
        throw new BadRequestException('Invalid offered slot details in queue');
      }

      await tx.appointmentQueue.update({
        where: { id: queueId },
        data: {
          status: 'ACCEPTED',
          appointmentId: newApp.id,
        },
      });

      return newApp;
    });
  }

  // Reject waitlist offer
  async rejectWaitlistOffer(patientUserId: number, queueId: number) {
    const queueEntry = await this.prisma.appointmentQueue.findUnique({
      where: { id: queueId },
      include: { patientProfile: true },
    });

    if (!queueEntry) {
      throw new NotFoundException('Queue entry not found');
    }

    if (queueEntry.patientProfile.userId !== patientUserId) {
      throw new ForbiddenException('You do not have access to this waitlist entry');
    }

    if (queueEntry.status !== 'OFFERED') {
      throw new BadRequestException('No active offer for this waitlist entry');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.appointmentQueue.update({
        where: { id: queueId },
        data: { status: 'REJECTED' },
      });

      // Pass the offer to the next patient in READY queue (FIFO)
      const nextInQueue = await tx.appointmentQueue.findFirst({
        where: {
          doctorProfileId: queueEntry.doctorProfileId,
          queueType: 'READY',
          status: 'PENDING',
        },
        orderBy: { createdAt: 'asc' },
      });

      if (nextInQueue) {
        await tx.appointmentQueue.update({
          where: { id: nextInQueue.id },
          data: {
            status: 'OFFERED',
            offeredSlotStart: queueEntry.offeredSlotStart,
            offeredSlotEnd: queueEntry.offeredSlotEnd,
            offeredWaveScheduleId: queueEntry.offeredWaveScheduleId,
          },
        });
      }

      return { message: 'Offer rejected successfully' };
    });
  }
}
