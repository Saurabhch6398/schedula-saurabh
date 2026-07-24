import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BookAppointmentDto } from './dto/book-appointment.dto';

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
    const docId = parseInt(dto.doctorId as string, 10);

    if (isNaN(docId)) {
      throw new BadRequestException('Invalid doctorId');
    }

    // Find Doctor
    const doctorProfile = await this.prisma.doctorProfile.findUnique({
      where: { id: docId },
    });
    if (!doctorProfile) {
      throw new NotFoundException('Doctor not found');
    }

    // Find Patient Profile
    const patientProfile = await this.prisma.patientProfile.findUnique({
      where: { userId: loggedInUserId },
    });
    if (!patientProfile) {
      throw new NotFoundException('Patient profile not found');
    }

    const now = Date.now();

    if (doctorProfile.schedulingType === 'STREAM') {
      if (!dto.slot) {
        throw new BadRequestException('slot is required for STREAM scheduling');
      }

      const dateStr = dto.date ?? new Date().toISOString().split('T')[0];
      const [year, month, day] = dateStr.split('-').map(Number);
      if (isNaN(year) || isNaN(month) || isNaN(day)) {
        throw new BadRequestException('Invalid date format. Use YYYY-MM-DD');
      }

      const startMin = this.parseTimeToMinutes(dto.slot);
      const slotDuration = doctorProfile.slotDuration;
      if (!slotDuration || slotDuration <= 0) {
        throw new BadRequestException('Invalid slot duration');
      }
      const endMin = startMin + slotDuration;

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

      // Past slot check
      if (slotStartDt.getTime() < now) {
        throw new BadRequestException('Cannot book appointment in the past');
      }

      // Check duplicate booking (patient already booked this slot)
      const duplicate = await this.prisma.appointment.findFirst({
        where: {
          doctorProfileId: doctorProfile.id,
          patientProfileId: patientProfile.id,
          slotStart: slotStartDt,
        },
      });
      if (duplicate) {
        throw new ConflictException('Duplicate booking');
      }

      // Check if slot is already booked by another patient
      const slotBooked = await this.prisma.appointment.findFirst({
        where: {
          doctorProfileId: doctorProfile.id,
          slotStart: slotStartDt,
          slotEnd: slotEndDt,
        },
      });
      if (slotBooked) {
        throw new ConflictException('Slot is already booked');
      }

      // Verify slot availability window
      // 1. Overrides
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
          // Check if slot fits inside override slots
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
        // Recurring
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
        },
      });

      return {
        id: app.id,
        doctorId: doctorProfile.id,
        patientId: patientProfile.id,
        slotStart: app.slotStart!.toISOString(),
        slotEnd: app.slotEnd!.toISOString(),
        appointmentType: 'STREAM',
      };
    } else {
      // WAVE scheduling
      if (!dto.waveId) {
        throw new BadRequestException('waveId is required for WAVE scheduling');
      }

      const waveId = parseInt(dto.waveId as string, 10);

      if (isNaN(waveId)) {
        throw new BadRequestException('Invalid waveId');
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

      // Past wave check
      if (waveSchedule.endTime.getTime() < now) {
        throw new BadRequestException('Cannot book appointment in the past');
      }

      // Check duplicate booking
      const duplicate = await this.prisma.appointment.findFirst({
        where: {
          waveScheduleId: waveSchedule.id,
          patientProfileId: patientProfile.id,
        },
      });
      if (duplicate) {
        throw new ConflictException('Duplicate booking');
      }

      // Capacity check
      const count = await this.prisma.appointment.count({
        where: { waveScheduleId: waveSchedule.id },
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
        },
      });

      const startStr = this.formatToAMPM(waveSchedule.startTime);
      const endStr = this.formatToAMPM(waveSchedule.endTime);

      return {
        id: app.id,
        appointmentWindow: `${startStr}-${endStr}`,
        tokenNumber,
      };
    }
  }

  // Get appointment details
  async getAppointmentDetails(loggedInUserId: number, appointmentId: number) {
    const app = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        doctorProfile: true,
        patientProfile: true,
        waveSchedule: true,
      },
    });

    if (!app) {
      throw new NotFoundException('Appointment not found');
    }

    // Verify ownership (either doctor or patient)
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
        createdAt: app.createdAt.toISOString(),
      };
    }
  }
}
