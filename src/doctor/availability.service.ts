import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { AvailabilityRepository } from './availability.repository';
import { CreateAvailabilityDto } from './dto/create-availability.dto';
import { UpdateAvailabilityDto } from './dto/update-availability.dto';
import { CreateOverrideDto } from './dto/create-override.dto';
import { PrismaService } from '../prisma/prisma.service';
import { DoctorProfile } from '@prisma/client';

export interface WaveWindowResponse {
  id: number;
  window: string;
  available: string;
  maxCapacity: number;
  bookedCount: number;
}

@Injectable()
export class AvailabilityService {
  constructor(
    private readonly availabilityRepo: AvailabilityRepository,
    private readonly prisma: PrismaService,
  ) {}

  // Helper: Parses 24h or 12h time string to minutes from midnight
  private parseTimeToMinutes(timeStr: string): number {
    const cleaned = timeStr.trim().toUpperCase();

    // 12-hour format: e.g. "10:00 AM", "1:00 PM"
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

    // 24-hour format: e.g. "10:00", "13:00"
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

  // Helper: Parses and validates YYYY-MM-DD date in UTC
  private parseAndValidateDate(dateStr: string): Date {
    const parts = dateStr.split('-');
    if (parts.length !== 3) {
      throw new BadRequestException('Invalid date format. Use YYYY-MM-DD');
    }
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);
    const day = parseInt(parts[2], 10);

    if (isNaN(year) || isNaN(month) || isNaN(day)) {
      throw new BadRequestException('Invalid date format. Use YYYY-MM-DD');
    }
    if (month < 1 || month > 12) {
      throw new BadRequestException('Invalid month value');
    }
    if (day < 1 || day > 31) {
      throw new BadRequestException('Invalid day value');
    }

    const dateObj = new Date(Date.UTC(year, month - 1, day));
    if (
      dateObj.getUTCFullYear() !== year ||
      dateObj.getUTCMonth() !== month - 1 ||
      dateObj.getUTCDate() !== day
    ) {
      throw new BadRequestException('Invalid calendar date');
    }

    return dateObj;
  }

  // Helper: Resolves day of week from UTC Date
  private getDayOfWeekFromDate(date: Date): string {
    const dayNames = [
      'SUNDAY',
      'MONDAY',
      'TUESDAY',
      'WEDNESDAY',
      'THURSDAY',
      'FRIDAY',
      'SATURDAY',
    ];
    return dayNames[date.getUTCDay()];
  }

  // GET doctor profile helper
  private async getDoctorProfile(userId: number) {
    const profile =
      await this.availabilityRepo.findDoctorProfileByUserId(userId);
    if (!profile) {
      throw new NotFoundException('Doctor profile not found');
    }
    return profile;
  }

  // Create Recurring Availability or WaveSchedule
  async createRecurring(userId: number, dto: CreateAvailabilityDto) {
    const profile = await this.getDoctorProfile(userId);

    if (profile.schedulingType === 'WAVE') {
      const maxCapacity = dto.maxCapacity;
      if (
        maxCapacity === undefined ||
        maxCapacity === null ||
        maxCapacity <= 0
      ) {
        throw new BadRequestException('Invalid capacity');
      }

      let startDt: Date;
      let endDt: Date;

      if (dto.date) {
        const dateObj = this.parseAndValidateDate(dto.date);

        // Parse time strings
        const startMin = this.parseTimeToMinutes(dto.startTime);
        const endMin = this.parseTimeToMinutes(dto.endTime);
        if (startMin >= endMin) {
          throw new BadRequestException('Start time must be before end time');
        }

        const startHour = Math.floor(startMin / 60);
        const startMins = startMin % 60;
        const endHour = Math.floor(endMin / 60);
        const endMins = endMin % 60;

        startDt = new Date(
          Date.UTC(
            dateObj.getUTCFullYear(),
            dateObj.getUTCMonth(),
            dateObj.getUTCDate(),
            startHour,
            startMins,
          ),
        );
        endDt = new Date(
          Date.UTC(
            dateObj.getUTCFullYear(),
            dateObj.getUTCMonth(),
            dateObj.getUTCDate(),
            endHour,
            endMins,
          ),
        );
      } else {
        // Assume ISO strings
        startDt = new Date(dto.startTime);
        endDt = new Date(dto.endTime);
        if (isNaN(startDt.getTime()) || isNaN(endDt.getTime())) {
          throw new BadRequestException('Invalid date/time format');
        }
        if (startDt.getTime() >= endDt.getTime()) {
          throw new BadRequestException('Start time must be before end time');
        }
      }

      // Check overlap
      const overlap = await this.availabilityRepo.checkWaveOverlap(
        profile.id,
        startDt,
        endDt,
      );
      if (overlap) {
        throw new ConflictException('Conflicting schedule');
      }

      await this.availabilityRepo.createWaveSchedule(
        profile.id,
        startDt,
        endDt,
        maxCapacity,
      );
      return { message: 'Availability added successfully' };
    }

    if (!dto.dayOfWeek) {
      throw new BadRequestException('Day of week is required');
    }

    const startMin = this.parseTimeToMinutes(dto.startTime);
    const endMin = this.parseTimeToMinutes(dto.endTime);

    if (startMin >= endMin) {
      throw new BadRequestException('Start time must be before end time');
    }

    // Format to standard 24h
    const formattedStart = this.minutesToTimeString(startMin);
    const formattedEnd = this.minutesToTimeString(endMin);

    // Overlap checks
    const existing = await this.availabilityRepo.findRecurringByDoctorAndDay(
      profile.id,
      dto.dayOfWeek.toUpperCase(),
    );

    for (const slot of existing) {
      const slotStart = this.parseTimeToMinutes(slot.startTime);
      const slotEnd = this.parseTimeToMinutes(slot.endTime);

      if (startMin < slotEnd && endMin > slotStart) {
        throw new ConflictException('Conflicting schedule');
      }
    }

    await this.availabilityRepo.createRecurring(
      profile.id,
      dto.dayOfWeek.toUpperCase(),
      formattedStart,
      formattedEnd,
    );

    return { message: 'Availability added successfully' };
  }

  // Get all recurring for logged in doctor
  async getRecurring(userId: number) {
    const profile = await this.getDoctorProfile(userId);
    if (profile.schedulingType === 'WAVE') {
      const waveSchedules =
        await this.availabilityRepo.findWaveSchedulesByDoctor(profile.id);
      return waveSchedules.map((ws) => ({
        id: ws.id,
        startTime: this.minutesToTimeString(
          ws.startTime.getUTCHours() * 60 + ws.startTime.getUTCMinutes(),
        ),
        endTime: this.minutesToTimeString(
          ws.endTime.getUTCHours() * 60 + ws.endTime.getUTCMinutes(),
        ),
        maxCapacity: ws.maxCapacity,
        date: ws.startTime.toISOString().split('T')[0],
        isWave: true,
      }));
    }

    const slots = await this.availabilityRepo.findRecurringByDoctor(profile.id);
    return slots.map((s) => ({
      id: s.id,
      day: s.dayOfWeek,
      dayOfWeek: s.dayOfWeek,
      startTime: s.startTime,
      endTime: s.endTime,
    }));
  }

  // Update Recurring
  async updateRecurring(
    userId: number,
    id: number,
    dto: UpdateAvailabilityDto,
  ) {
    const profile = await this.getDoctorProfile(userId);

    // Try finding in RecurringAvailability
    const slot = await this.availabilityRepo.findRecurringById(id);
    if (slot) {
      if (slot.doctorProfileId !== profile.id) {
        throw new ForbiddenException('You do not have access to this slot');
      }

      const nextDay = dto.dayOfWeek?.toUpperCase() ?? slot.dayOfWeek;
      const nextStartStr = dto.startTime ?? slot.startTime;
      const nextEndStr = dto.endTime ?? slot.endTime;

      const startMin = this.parseTimeToMinutes(nextStartStr);
      const endMin = this.parseTimeToMinutes(nextEndStr);

      if (startMin >= endMin) {
        throw new BadRequestException('Start time must be before end time');
      }

      const formattedStart = this.minutesToTimeString(startMin);
      const formattedEnd = this.minutesToTimeString(endMin);

      // Overlap checks (excluding current slot)
      const existing = await this.availabilityRepo.findRecurringByDoctorAndDay(
        profile.id,
        nextDay,
      );
      for (const item of existing) {
        if (item.id === id) continue;

        const slotStart = this.parseTimeToMinutes(item.startTime);
        const slotEnd = this.parseTimeToMinutes(item.endTime);

        if (startMin < slotEnd && endMin > slotStart) {
          throw new ConflictException('Conflicting schedule');
        }
      }

      await this.availabilityRepo.updateRecurring(id, {
        dayOfWeek: nextDay,
        startTime: formattedStart,
        endTime: formattedEnd,
      });

      return { message: 'Availability updated successfully' };
    }

    // Try finding in WaveSchedule
    const waveSlot = await this.prisma.waveSchedule.findUnique({
      where: { id },
    });
    if (waveSlot) {
      if (waveSlot.doctorProfileId !== profile.id) {
        throw new ForbiddenException('You do not have access to this slot');
      }

      let startDt = waveSlot.startTime;
      let endDt = waveSlot.endTime;
      let maxCapacity = waveSlot.maxCapacity;

      if (dto.maxCapacity !== undefined && dto.maxCapacity !== null) {
        if (dto.maxCapacity <= 0) {
          throw new BadRequestException('Invalid capacity');
        }
        maxCapacity = dto.maxCapacity;
      }

      const existingDate = waveSlot.startTime;

      if (dto.startTime || dto.endTime) {
        const startStr =
          dto.startTime ??
          this.minutesToTimeString(
            waveSlot.startTime.getUTCHours() * 60 +
              waveSlot.startTime.getUTCMinutes(),
          );
        const endStr =
          dto.endTime ??
          this.minutesToTimeString(
            waveSlot.endTime.getUTCHours() * 60 +
              waveSlot.endTime.getUTCMinutes(),
          );

        const startMin = this.parseTimeToMinutes(startStr);
        const endMin = this.parseTimeToMinutes(endStr);
        if (startMin >= endMin) {
          throw new BadRequestException('Start time must be before end time');
        }

        startDt = new Date(
          Date.UTC(
            existingDate.getUTCFullYear(),
            existingDate.getUTCMonth(),
            existingDate.getUTCDate(),
            Math.floor(startMin / 60),
            startMin % 60,
          ),
        );
        endDt = new Date(
          Date.UTC(
            existingDate.getUTCFullYear(),
            existingDate.getUTCMonth(),
            existingDate.getUTCDate(),
            Math.floor(endMin / 60),
            endMin % 60,
          ),
        );
      }

      // Check overlap
      const overlap = await this.prisma.waveSchedule.findFirst({
        where: {
          doctorProfileId: profile.id,
          id: { not: id },
          startTime: { lt: endDt },
          endTime: { gt: startDt },
        },
      });
      if (overlap) {
        throw new ConflictException('Conflicting schedule');
      }

      await this.prisma.waveSchedule.update({
        where: { id },
        data: {
          startTime: startDt,
          endTime: endDt,
          maxCapacity,
        },
      });

      return { message: 'Availability updated successfully' };
    }

    throw new NotFoundException('Availability slot not found');
  }

  // Delete Recurring
  async deleteRecurring(userId: number, id: number) {
    const profile = await this.getDoctorProfile(userId);

    // Try deleting from RecurringAvailability
    const slot = await this.availabilityRepo.findRecurringById(id);
    if (slot) {
      if (slot.doctorProfileId !== profile.id) {
        throw new ForbiddenException('You do not have access to this slot');
      }
      await this.availabilityRepo.deleteRecurring(id);
      return { message: 'Availability deleted successfully' };
    }

    // Try deleting from WaveSchedule
    const waveSlot = await this.prisma.waveSchedule.findUnique({
      where: { id },
    });
    if (waveSlot) {
      if (waveSlot.doctorProfileId !== profile.id) {
        throw new ForbiddenException('You do not have access to this slot');
      }
      await this.prisma.waveSchedule.delete({
        where: { id },
      });
      return { message: 'Availability deleted successfully' };
    }

    throw new NotFoundException('Availability slot not found');
  }

  // Create Custom Override
  async createOverride(userId: number, dto: CreateOverrideDto) {
    const profile = await this.getDoctorProfile(userId);
    const dateObj = this.parseAndValidateDate(dto.date);

    // If startTime and endTime are provided, check range and format them
    const slots: {
      startTime?: string;
      endTime?: string;
      isAvailable: boolean;
    }[] = [];

    if (dto.startTime || dto.endTime) {
      if (!dto.startTime || !dto.endTime) {
        throw new BadRequestException(
          'Both startTime and endTime must be provided to set a slot',
        );
      }

      const startMin = this.parseTimeToMinutes(dto.startTime);
      const endMin = this.parseTimeToMinutes(dto.endTime);

      if (startMin >= endMin) {
        throw new BadRequestException('Start time must be before end time');
      }

      const formattedStart = this.minutesToTimeString(startMin);
      const formattedEnd = this.minutesToTimeString(endMin);

      // Verify no overlap among proposed override slots (currently we only support setting a single slot per override payload in standard DTO)
      slots.push({
        startTime: formattedStart,
        endTime: formattedEnd,
        isAvailable: true,
      });
    } else {
      // If neither is provided, treat it as setting the date to unavailable
      slots.push({
        isAvailable: false,
      });
    }

    await this.availabilityRepo.setCustomOverride(profile.id, dateObj, slots);
    return { message: 'Override added successfully' };
  }

  // Delete Custom Override (revert to recurring)
  async deleteOverride(userId: number, dateStr: string) {
    const profile = await this.getDoctorProfile(userId);
    const dateObj = this.parseAndValidateDate(dateStr);

    await this.availabilityRepo.deleteCustomOverride(profile.id, dateObj);
    return { message: 'Override removed successfully' };
  }

  // Get Availability for Particular Date (either override or recurring)
  async getAvailabilityForDate(
    dateStr: string,
    doctorId?: number,
    loggedInUserId?: number,
  ) {
    const dateObj = this.parseAndValidateDate(dateStr);

    let profile: DoctorProfile | null = null;

    if (doctorId) {
      profile = await this.availabilityRepo.findDoctorProfileById(doctorId);
      if (!profile) {
        throw new NotFoundException('Doctor not found');
      }
    } else if (loggedInUserId) {
      profile =
        await this.availabilityRepo.findDoctorProfileByUserId(loggedInUserId);
      if (!profile) {
        throw new NotFoundException('Doctor profile not found');
      }
    } else {
      throw new BadRequestException('doctorId is required');
    }

    const profileId = profile.id;

    if (profile.schedulingType === 'WAVE') {
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

      const waveSchedules = await this.prisma.waveSchedule.findMany({
        where: {
          doctorProfileId: profileId,
          startTime: {
            gte: startOfDay,
            lte: endOfDay,
          },
        },
        orderBy: { startTime: 'asc' },
      });

      return waveSchedules.map((ws) => ({
        id: ws.id,
        startTime: this.minutesToTimeString(
          ws.startTime.getUTCHours() * 60 + ws.startTime.getUTCMinutes(),
        ),
        endTime: this.minutesToTimeString(
          ws.endTime.getUTCHours() * 60 + ws.endTime.getUTCMinutes(),
        ),
        maxCapacity: ws.maxCapacity,
        isWave: true,
      }));
    }

    // 1. Check if override exists
    const overrides = await this.availabilityRepo.findCustomByDoctorAndDate(
      profileId,
      dateObj,
    );

    if (overrides.length > 0) {
      // Check if overridden to unavailable
      const unavailable = overrides.some((o) => !o.isAvailable);
      if (unavailable) {
        return [];
      }

      return overrides.map((o) => ({
        id: o.id,
        date: dateStr,
        startTime: o.startTime,
        endTime: o.endTime,
        isOverride: true,
      }));
    }

    // 2. Fall back to recurring weekly schedule
    const dayOfWeek = this.getDayOfWeekFromDate(dateObj);
    const recurring = await this.availabilityRepo.findRecurringByDoctorAndDay(
      profileId,
      dayOfWeek,
    );

    return recurring.map((r) => ({
      id: r.id,
      day: r.dayOfWeek,
      startTime: r.startTime,
      endTime: r.endTime,
      isOverride: false,
    }));
  }

  async getDoctorAllAvailability(doctorId: number) {
    const profile = await this.availabilityRepo.findDoctorProfileById(doctorId);
    if (!profile) {
      throw new NotFoundException('Doctor not found');
    }

    if (profile.schedulingType === 'WAVE') {
      const waveSchedules =
        await this.availabilityRepo.findWaveSchedulesByDoctor(profile.id);
      return waveSchedules.map((ws) => ({
        id: ws.id,
        startTime: ws.startTime.toISOString(),
        endTime: ws.endTime.toISOString(),
        maxCapacity: ws.maxCapacity,
      }));
    }

    const recurring = await this.availabilityRepo.findRecurringByDoctor(
      profile.id,
    );
    return recurring.map((r) => ({
      id: r.id,
      day: r.dayOfWeek,
      startTime: r.startTime,
      endTime: r.endTime,
      isOverride: false,
    }));
  }

  async getStreamSlots(doctorId: number, dateStr: string) {
    const profile = await this.availabilityRepo.findDoctorProfileById(doctorId);
    if (!profile) {
      throw new NotFoundException('Doctor not found');
    }
    if (profile.schedulingType !== 'STREAM') {
      throw new BadRequestException('Doctor scheduling type is not STREAM');
    }

    const slotDuration = profile.slotDuration;
    const bufferTime = profile.bufferTime ?? 0;
    if (!slotDuration || slotDuration <= 0) {
      throw new BadRequestException('Invalid slot duration');
    }

    this.parseAndValidateDate(dateStr);
    const availabilities = await this.getAvailabilityForDate(dateStr, doctorId);

    const [year, month, day] = dateStr.split('-').map(Number);

    // Fetch existing appointments for this doctor on this date
    const startOfDay = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
    const endOfDay = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
    const appointments = await this.prisma.appointment.findMany({
      where: {
        doctorProfileId: profile.id,
        appointmentType: 'STREAM',
        slotStart: {
          gte: startOfDay,
          lte: endOfDay,
        },
        status: 'BOOKED',
      },
    });

    const generatedSlots: { slot: string; start: string; end: string }[] = [];

    const now = Date.now();

    for (const avail of availabilities) {
      if (!avail.startTime || !avail.endTime) {
        continue;
      }
      const startMin = this.parseTimeToMinutes(avail.startTime);
      const endMin = this.parseTimeToMinutes(avail.endTime);

      let current = startMin;
      while (current + slotDuration <= endMin) {
        const slotStartMin = current;
        const slotEndMin = current + slotDuration;

        const slotStartStr = this.minutesToTimeString(slotStartMin);
        const slotEndStr = this.minutesToTimeString(slotEndMin);

        // Convert to Date for comparison with now and existing appointments (using UTC to align with dateStr)
        const slotStartHour = Math.floor(slotStartMin / 60);
        const slotStartMins = slotStartMin % 60;
        const slotStartDt = new Date(
          Date.UTC(year, month - 1, day, slotStartHour, slotStartMins),
        );

        // Past slot check (since everything is in UTC, compare UTC timestamp with now)
        if (slotStartDt.getTime() < now) {
          current = current + slotDuration + bufferTime;
          continue;
        }

        // Booked check
        const isBooked = appointments.some((app) => {
          if (!app.slotStart || !app.slotEnd) {
            return false;
          }
          const appStartMin =
            app.slotStart.getUTCHours() * 60 + app.slotStart.getUTCMinutes();
          const appEndMin =
            app.slotEnd.getUTCHours() * 60 + app.slotEnd.getUTCMinutes();
          return appStartMin === slotStartMin && appEndMin === slotEndMin;
        });

        if (!isBooked) {
          generatedSlots.push({
            slot: `${slotStartStr}-${slotEndStr}`,
            start: slotStartStr,
            end: slotEndStr,
          });
        }

        current = current + slotDuration + bufferTime;
      }
    }

    return generatedSlots;
  }

  async getWaveWindows(doctorId: number, dateStr: string) {
    const profile = await this.availabilityRepo.findDoctorProfileById(doctorId);
    if (!profile) {
      throw new NotFoundException('Doctor not found');
    }
    if (profile.schedulingType !== 'WAVE') {
      throw new BadRequestException('Doctor scheduling type is not WAVE');
    }

    const dateObj = this.parseAndValidateDate(dateStr);
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

    const waves = await this.prisma.waveSchedule.findMany({
      where: {
        doctorProfileId: profile.id,
        startTime: {
          gte: startOfDay,
          lte: endOfDay,
        },
      },
      orderBy: { startTime: 'asc' },
    });

    const results: WaveWindowResponse[] = [];
    const now = Date.now();

    for (const wave of waves) {
      if (wave.endTime.getTime() < now) {
        continue;
      }

      // Count booked appointments for this wave
      const bookedCount = await this.prisma.appointment.count({
        where: {
          waveScheduleId: wave.id,
          status: 'BOOKED',
        },
      });

      const startStr = this.formatToAMPM(wave.startTime);
      const endStr = this.formatToAMPM(wave.endTime);

      results.push({
        id: wave.id,
        window: `${startStr}-${endStr}`,
        available: `${wave.maxCapacity - bookedCount}/${wave.maxCapacity}`,
        maxCapacity: wave.maxCapacity,
        bookedCount,
      });
    }

    return results;
  }

  private formatToAMPM(date: Date): string {
    let hours = date.getUTCHours();
    const minutes = date.getUTCMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12; // 0 should be 12
    const minutesStr = minutes < 10 ? '0' + minutes : minutes;
    return minutes === 0 ? `${hours}${ampm}` : `${hours}:${minutesStr}${ampm}`;
  }
}
