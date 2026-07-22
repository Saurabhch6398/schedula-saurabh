import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DoctorService {
  constructor(private prisma: PrismaService) {}

  async getProfile(userId: number) {
    const doctor = await this.prisma.doctor.findUnique({
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

    if (!doctor) {
      throw new NotFoundException('Doctor profile not found');
    }

    return {
      message: 'Welcome Doctor',
      doctor: {
        id: doctor.id,
        name: `${doctor.user.firstName} ${doctor.user.lastName}`.trim(),
        email: doctor.user.email,
        specialization: doctor.specialization,
        clinicName: doctor.clinicName,
        biography: doctor.biography,
        address: doctor.address,
        consultationFee: doctor.consultationFee,
      },
    };
  }
}
