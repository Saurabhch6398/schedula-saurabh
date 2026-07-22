import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PatientService {
  constructor(private prisma: PrismaService) {}

  async getProfile(userId: number) {
    // A user can manage multiple patient profiles; we fetch the primary one matching the user's ID
    const patient = await this.prisma.patient.findFirst({
      where: { userId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            phone: true,
            role: true,
          },
        },
      },
    });

    if (!patient) {
      throw new NotFoundException('Patient profile not found');
    }

    return {
      message: 'Welcome Patient',
      patient: {
        id: patient.id,
        name: patient.name,
        email: patient.user.email,
        dateOfBirth: patient.dateOfBirth,
        sex: patient.sex,
        weight: patient.weight,
        bloodGroup: patient.bloodGroup,
        medicalHistory: patient.medicalHistory,
      },
    };
  }
}
