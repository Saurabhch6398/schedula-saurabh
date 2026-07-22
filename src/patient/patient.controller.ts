import { Controller, Get, UseGuards, Request } from '@nestjs/common';
import { PatientService } from './patient.service';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('patient')
@UseGuards(AuthGuard, RolesGuard)
export class PatientController {
  constructor(private readonly patientService: PatientService) {}

  @Get('profile')
  @Roles('PATIENT')
  async getProfile(@Request() req) {
    return this.patientService.getProfile(req.user.userId);
  }
}
