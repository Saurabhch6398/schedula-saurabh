import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDoctorProfileDto } from './dto/create-doctor-profile.dto';
import { UpdateDoctorProfileDto } from './dto/update-doctor-profile.dto';

@Injectable()
export class DoctorService {
  constructor(private prisma: PrismaService) {}

  async createProfile(userId: number, dto: CreateDoctorProfileDto) {
    // Prevent duplicate onboarding/profile creation
    const existing = await this.prisma.doctorProfile.findUnique({
      where: { userId },
    });
    if (existing) {
      throw new ConflictException('Doctor profile already exists');
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
      throw new NotFoundException('Profile not found');
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
    };
  }

  async updateProfile(userId: number, dto: UpdateDoctorProfileDto) {
    const profile = await this.prisma.doctorProfile.findUnique({
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
    const { fullName, specialization, experience, qualification, consultationFee, availability, profileDetails } = dto;

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
        },
      });
    });

    return { message: 'Doctor profile updated successfully' };
  }
}
