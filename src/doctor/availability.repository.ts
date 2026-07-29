import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AvailabilityRepository {
  constructor(private prisma: PrismaService) {}

  async findDoctorProfileByUserId(userId: number) {
    return this.prisma.doctorProfile.findUnique({
      where: { userId },
    });
  }

  async findDoctorProfileById(id: number) {
    return this.prisma.doctorProfile.findUnique({
      where: { id },
    });
  }

  async findRecurringByDoctorAndDay(doctorProfileId: number, dayOfWeek: string) {
    return this.prisma.recurringAvailability.findMany({
      where: {
        doctorProfileId,
        dayOfWeek,
      },
    });
  }

  async findRecurringByDoctor(doctorProfileId: number) {
    return this.prisma.recurringAvailability.findMany({
      where: { doctorProfileId },
      orderBy: [
        { dayOfWeek: 'asc' }, // Let's keep dayOfWeek ordered
        { startTime: 'asc' },
      ],
    });
  }

  async findRecurringById(id: number) {
    return this.prisma.recurringAvailability.findUnique({
      where: { id },
    });
  }

  async createRecurring(doctorProfileId: number, dayOfWeek: string, startTime: string, endTime: string) {
    return this.prisma.recurringAvailability.create({
      data: {
        doctorProfileId,
        dayOfWeek,
        startTime,
        endTime,
      },
    });
  }

  async updateRecurring(id: number, data: { dayOfWeek?: string; startTime?: string; endTime?: string }) {
    return this.prisma.recurringAvailability.update({
      where: { id },
      data,
    });
  }

  async deleteRecurring(id: number) {
    return this.prisma.recurringAvailability.delete({
      where: { id },
    });
  }

  async findCustomByDoctorAndDate(doctorProfileId: number, date: Date) {
    return this.prisma.customAvailability.findMany({
      where: {
        doctorProfileId,
        date,
      },
      orderBy: { startTime: 'asc' },
    });
  }

  async setCustomOverride(
    doctorProfileId: number,
    date: Date,
    slots: { startTime?: string; endTime?: string; isAvailable: boolean }[],
  ) {
    return this.prisma.$transaction(async (tx) => {
      // 1. Delete all existing overrides for this doctor on this specific date
      await tx.customAvailability.deleteMany({
        where: {
          doctorProfileId,
          date,
        },
      });

      // 2. Insert new overrides
      const created: any[] = [];
      for (const slot of slots) {
        const item = await tx.customAvailability.create({
          data: {
            doctorProfileId,
            date,
            startTime: slot.startTime ?? null,
            endTime: slot.endTime ?? null,
            isAvailable: slot.isAvailable,
          },
        });
        created.push(item);
      }
      return created;
    });
  }

  async deleteCustomOverride(doctorProfileId: number, date: Date) {
    return this.prisma.customAvailability.deleteMany({
      where: {
        doctorProfileId,
        date,
      },
    });
  }
}
