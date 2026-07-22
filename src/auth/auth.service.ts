import { Injectable, ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async signup(signupDto: SignupDto) {
    const { name, email, password, role } = signupDto;

    // Check if email already exists
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new ConflictException('Email is already registered');
    }

    // Hash password
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Split name into first and last name
    const nameParts = name.trim().split(/\s+/);
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';

    // Create user and profile in transaction
    const newUser = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          passwordHash,
          firstName,
          lastName,
          role,
        },
      });

      if (role === 'DOCTOR') {
        await tx.doctor.create({
          data: {
            userId: user.id,
            // specialisation, clinicName etc. can be updated later
          },
        });
      } else if (role === 'PATIENT') {
        await tx.patient.create({
          data: {
            userId: user.id,
            name: name.trim(),
            // DOB, sex etc. can be updated later
          },
        });
      }

      return user;
    });

    // Return the response containing basic details
    return {
      message: 'User registered successfully',
      user: {
        id: newUser.id,
        name: `${newUser.firstName} ${newUser.lastName}`.trim(),
        email: newUser.email,
        role: newUser.role,
      },
    };
  }

  async login(loginDto: LoginDto) {
    const { email, password } = loginDto;

    // Find user
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Generate token
    const payload = { userId: user.id, email: user.email, role: user.role };
    const token = await this.jwtService.signAsync(payload);

    return {
      message: 'Login Successful',
      token,
    };
  }
}
