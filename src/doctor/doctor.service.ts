import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDoctorProfileDto } from './dto/create-doctor-profile.dto';
import { UpdateDoctorProfileDto } from './dto/update-doctor-profile.dto';
import { SelectSchedulingDto } from './dto/select-scheduling.dto';

@Injectable()
export class DoctorService {
  constructor(private prisma: PrismaService) {}

  private validateSchedulingConfig(
    schedulingType?: 'STREAM' | 'WAVE',
    slotDuration?: number | null,
    bufferTime?: number | null,
    isSelection = false,
  ) {
    if (schedulingType === 'STREAM') {
      if (
        isSelection ||
        (slotDuration !== undefined && slotDuration !== null)
      ) {
        if (
          slotDuration === undefined ||
          slotDuration === null ||
          slotDuration <= 0
        ) {
          throw new BadRequestException('Invalid slot duration');
        }
      }
      if (bufferTime !== undefined && bufferTime !== null && bufferTime < 0) {
        throw new BadRequestException('Invalid buffer time');
      }
    }
  }

  async createProfile(userId: number, dto: CreateDoctorProfileDto) {
    // Prevent duplicate onboarding/profile creation
    const existing = await this.prisma.doctorProfile.findUnique({
      where: { userId },
    });
    if (existing) {
      throw new ConflictException('Doctor profile already exists');
    }

    const schedulingType = dto.schedulingType ?? 'STREAM';
    this.validateSchedulingConfig(
      schedulingType,
      dto.slotDuration,
      dto.bufferTime,
      false,
    );

    // Split fullName into firstName and lastName for User compatibility
    const parts = dto.fullName.trim().split(/\s+/);
    const firstName = parts[0] || '';
    const lastName = parts.slice(1).join(' ') || '';

    await this.prisma.$transaction(async (tx) => {
      // Update basic user profile name
      await tx.user.update({
        where: { id: userId },
        data: { firstName, lastName },
      });

      // Create new Doctor Profile record
      await tx.doctorProfile.create({
        data: {
          userId,
          fullName: dto.fullName,
          specialization: dto.specialization,
          experience: dto.experience,
          qualification: dto.qualification,
          consultationFee: dto.consultationFee,
          availability: dto.availability,
          profileDetails: dto.profileDetails,
          schedulingType,
          slotDuration: schedulingType === 'STREAM' ? dto.slotDuration : null,
          bufferTime:
            schedulingType === 'STREAM' ? (dto.bufferTime ?? 0) : null,
        },
      });
    });

    return { message: 'Doctor profile created successfully' };
  }

  async getProfile(userId: number) {
    const profile = await this.prisma.doctorProfile.findUnique({
      where: { userId },
    });

    if (!profile) {
      throw new NotFoundException('Doctor not found');
    }

    return {
      id: profile.id,
      userId: profile.userId,
      fullName: profile.fullName,
      specialization: profile.specialization,
      experience: profile.experience,
      qualification: profile.qualification,
      consultationFee: profile.consultationFee,
      availability: profile.availability,
      profileDetails: profile.profileDetails,
      schedulingType: profile.schedulingType,
      slotDuration: profile.slotDuration,
      bufferTime: profile.bufferTime,
    };
  }

  async updateProfile(userId: number, dto: UpdateDoctorProfileDto) {
    const profile = await this.prisma.doctorProfile.findUnique({
      where: { userId },
    });

    if (!profile) {
      throw new NotFoundException('Doctor not found');
    }

    // Prepare name update if fullName is provided
    let firstName: string | undefined;
    let lastName: string | undefined;
    if (dto.fullName !== undefined) {
      const parts = dto.fullName.trim().split(/\s+/);
      firstName = parts[0] || '';
      lastName = parts.slice(1).join(' ') || '';
    }

    // Validate if scheduling info is being updated
    const nextSchedulingType = dto.schedulingType ?? profile.schedulingType;
    const nextSlotDuration =
      dto.slotDuration !== undefined ? dto.slotDuration : profile.slotDuration;
    const nextBufferTime =
      dto.bufferTime !== undefined ? dto.bufferTime : profile.bufferTime;
    this.validateSchedulingConfig(
      nextSchedulingType,
      nextSlotDuration,
      nextBufferTime,
      false,
    );

    // Ignore restricted/sensitive field updates by only destructuring allowed fields
    const {
      fullName,
      specialization,
      experience,
      qualification,
      consultationFee,
      availability,
      profileDetails,
      schedulingType,
      slotDuration,
      bufferTime,
    } = dto;

    await this.prisma.$transaction(async (tx) => {
      if (firstName !== undefined) {
        await tx.user.update({
          where: { id: userId },
          data: { firstName, lastName },
        });
      }

      await tx.doctorProfile.update({
        where: { userId },
        data: {
          fullName,
          specialization,
          experience,
          qualification,
          consultationFee,
          availability,
          profileDetails,
          schedulingType: schedulingType,
          slotDuration:
            schedulingType === 'STREAM'
              ? slotDuration
              : schedulingType === 'WAVE'
                ? null
                : undefined,
          bufferTime:
            schedulingType === 'STREAM'
              ? (bufferTime ?? 0)
              : schedulingType === 'WAVE'
                ? null
                : undefined,
        },
      });
    });

    return { message: 'Doctor profile updated successfully' };
  }

  async updateScheduling(userId: number, dto: SelectSchedulingDto) {
    const profile = await this.prisma.doctorProfile.findUnique({
      where: { userId },
    });

    if (!profile) {
      throw new NotFoundException('Doctor not found');
    }

    this.validateSchedulingConfig(
      dto.type,
      dto.slotDuration,
      dto.bufferTime,
      true,
    );

    await this.prisma.doctorProfile.update({
      where: { userId },
      data: {
        schedulingType: dto.type,
        slotDuration: dto.type === 'STREAM' ? dto.slotDuration : null,
        bufferTime: dto.type === 'STREAM' ? (dto.bufferTime ?? 0) : null,
      },
    });

    return { message: 'Scheduling updated successfully' };
  }

  async getAllDoctors() {
    return this.prisma.doctorProfile.findMany({
      orderBy: { userId: 'asc' },
    });
  }
}

