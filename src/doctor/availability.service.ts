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

@Injectable()
export class AvailabilityService {
  constructor(private readonly availabilityRepo: AvailabilityRepository) {}

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

    throw new BadRequestException('Invalid time format. Use HH:MM or HH:MM AM/PM');
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
    const dayNames = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
    return dayNames[date.getUTCDay()];
  }

  // GET doctor profile helper
  private async getDoctorProfile(userId: number) {
    const profile = await this.availabilityRepo.findDoctorProfileByUserId(userId);
    if (!profile) {
      throw new NotFoundException('Doctor profile not found');
    }
    return profile;
  }

  // Create Recurring Availability
  async createRecurring(userId: number, dto: CreateAvailabilityDto) {
    const profile = await this.getDoctorProfile(userId);

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
        throw new ConflictException('Overlapping time slot');
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
  async updateRecurring(userId: number, id: number, dto: UpdateAvailabilityDto) {
    const profile = await this.getDoctorProfile(userId);
    const slot = await this.availabilityRepo.findRecurringById(id);

    if (!slot) {
      throw new NotFoundException('Recurring availability slot not found');
    }
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
    const existing = await this.availabilityRepo.findRecurringByDoctorAndDay(profile.id, nextDay);
    for (const item of existing) {
      if (item.id === id) continue;

      const slotStart = this.parseTimeToMinutes(item.startTime);
      const slotEnd = this.parseTimeToMinutes(item.endTime);

      if (startMin < slotEnd && endMin > slotStart) {
        throw new ConflictException('Overlapping time slot');
      }
    }

    await this.availabilityRepo.updateRecurring(id, {
      dayOfWeek: nextDay,
      startTime: formattedStart,
      endTime: formattedEnd,
    });

    return { message: 'Availability updated successfully' };
  }

  // Delete Recurring
  async deleteRecurring(userId: number, id: number) {
    const profile = await this.getDoctorProfile(userId);
    const slot = await this.availabilityRepo.findRecurringById(id);

    if (!slot) {
      throw new NotFoundException('Recurring availability slot not found');
    }
    if (slot.doctorProfileId !== profile.id) {
      throw new ForbiddenException('You do not have access to this slot');
    }

    await this.availabilityRepo.deleteRecurring(id);
    return { message: 'Availability deleted successfully' };
  }

  // Create Custom Override
  async createOverride(userId: number, dto: CreateOverrideDto) {
    const profile = await this.getDoctorProfile(userId);
    const dateObj = this.parseAndValidateDate(dto.date);

    // If startTime and endTime are provided, check range and format them
    let slots: { startTime?: string; endTime?: string; isAvailable: boolean }[] = [];

    if (dto.startTime || dto.endTime) {
      if (!dto.startTime || !dto.endTime) {
        throw new BadRequestException('Both startTime and endTime must be provided to set a slot');
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
  async getAvailabilityForDate(dateStr: string, doctorId?: number, loggedInUserId?: number) {
    const dateObj = this.parseAndValidateDate(dateStr);

    let profileId: number;

    if (doctorId) {
      // Queried by patient or doctor by doctorProfileId
      const profile = await this.availabilityRepo.findDoctorProfileById(doctorId);
      if (!profile) {
        throw new NotFoundException('Doctor not found');
      }
      profileId = profile.id;
    } else if (loggedInUserId) {
      // Logged in user defaults if role is doctor
      const profile = await this.availabilityRepo.findDoctorProfileByUserId(loggedInUserId);
      if (!profile) {
        throw new NotFoundException('Doctor profile not found');
      }
      profileId = profile.id;
    } else {
      throw new BadRequestException('doctorId is required');
    }

    // 1. Check if override exists
    const overrides = await this.availabilityRepo.findCustomByDoctorAndDate(profileId, dateObj);

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
    const recurring = await this.availabilityRepo.findRecurringByDoctorAndDay(profileId, dayOfWeek);

    return recurring.map((r) => ({
      id: r.id,
      day: r.dayOfWeek,
      startTime: r.startTime,
      endTime: r.endTime,
      isOverride: false,
    }));
  }
}
