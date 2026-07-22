import { Controller, Get, Post, Patch, Body, UseGuards, Request } from '@nestjs/common';
import { DoctorService } from './doctor.service';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateDoctorProfileDto } from './dto/create-doctor-profile.dto';
import { UpdateDoctorProfileDto } from './dto/update-doctor-profile.dto';

@Controller('doctor')
@UseGuards(AuthGuard, RolesGuard)
export class DoctorController {
  constructor(private readonly doctorService: DoctorService) {}

  @Post('profile')
  @Roles('DOCTOR')
  async createProfile(@Request() req, @Body() dto: CreateDoctorProfileDto) {
    return this.doctorService.createProfile(req.user.userId, dto);
  }

  @Get('profile')
  @Roles('DOCTOR')
  async getProfile(@Request() req) {
    return this.doctorService.getProfile(req.user.userId);
  }

  @Patch('profile')
  @Roles('DOCTOR')
  async updateProfile(@Request() req, @Body() dto: UpdateDoctorProfileDto) {
    return this.doctorService.updateProfile(req.user.userId, dto);
  }
}
