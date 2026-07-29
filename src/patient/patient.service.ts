import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePatientProfileDto } from './dto/create-patient-profile.dto';
import { UpdatePatientProfileDto } from './dto/update-patient-profile.dto';

@Injectable()
export class PatientService {
  constructor(private prisma: PrismaService) {}

  async createProfile(userId: number, dto: CreatePatientProfileDto) {
    // Prevent duplicate onboarding/profile creation
    const existing = await this.prisma.patientProfile.findUnique({
      where: { userId },
    });
    if (existing) {
      throw new ConflictException('Patient profile already exists');
    }

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

      // Create new Patient Profile record
      await tx.patientProfile.create({
        data: {
          userId,
          fullName: dto.fullName,
          age: dto.age,
          gender: dto.gender,
          contact: dto.contact,
          healthInfo: dto.healthInfo,
        },
      });
    });

    return { message: 'Patient profile created successfully' };
  }

  async getProfile(userId: number) {
    const profile = await this.prisma.patientProfile.findUnique({
      where: { userId },
    });

    if (!profile) {
      throw new NotFoundException('Profile not found');
    }

    return {
      id: profile.id,
      userId: profile.userId,
      fullName: profile.fullName,
      age: profile.age,
      gender: profile.gender,
      contact: profile.contact,
      healthInfo: profile.healthInfo,
    };
  }

  async updateProfile(userId: number, dto: UpdatePatientProfileDto) {
    const profile = await this.prisma.patientProfile.findUnique({
      where: { userId },
    });

    if (!profile) {
      throw new NotFoundException('Profile not found');
    }

    // Prepare name update if fullName is provided
    let firstName: string | undefined;
    let lastName: string | undefined;
    if (dto.fullName !== undefined) {
      const parts = dto.fullName.trim().split(/\s+/);
      firstName = parts[0] || '';
      lastName = parts.slice(1).join(' ') || '';
    }

    // Ignore restricted/sensitive field updates by only destructuring allowed fields
    const { fullName, age, gender, contact, healthInfo } = dto;

    await this.prisma.$transaction(async (tx) => {
      if (firstName !== undefined) {
        await tx.user.update({
          where: { id: userId },
          data: { firstName, lastName },
        });
      }

      await tx.patientProfile.update({
        where: { userId },
        data: {
          fullName,
          age,
          gender,
          contact,
          healthInfo,
        },
      });
    });

    return { message: 'Patient profile updated successfully' };
  }
}
