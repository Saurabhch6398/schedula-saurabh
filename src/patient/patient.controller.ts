import { Controller, Get, Post, Patch, Body, UseGuards, Request } from '@nestjs/common';
import { PatientService } from './patient.service';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreatePatientProfileDto } from './dto/create-patient-profile.dto';
import { UpdatePatientProfileDto } from './dto/update-patient-profile.dto';

@Controller('patient')
@UseGuards(AuthGuard, RolesGuard)
export class PatientController {
  constructor(private readonly patientService: PatientService) {}

  @Post('profile')
  @Roles('PATIENT')
  async createProfile(@Request() req, @Body() dto: CreatePatientProfileDto) {
    return this.patientService.createProfile(req.user.userId, dto);
  }

  @Get('profile')
  @Roles('PATIENT')
  async getProfile(@Request() req) {
    return this.patientService.getProfile(req.user.userId);
  }

  @Patch('profile')
  @Roles('PATIENT')
  async updateProfile(@Request() req, @Body() dto: UpdatePatientProfileDto) {
    return this.patientService.updateProfile(req.user.userId, dto);
  }
}
