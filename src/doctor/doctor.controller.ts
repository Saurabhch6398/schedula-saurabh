import { Controller, Get, UseGuards, Request } from '@nestjs/common';
import { DoctorService } from './doctor.service';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('doctor')
@UseGuards(AuthGuard, RolesGuard)
export class DoctorController {
  constructor(private readonly doctorService: DoctorService) {}

  @Get('profile')
  @Roles('DOCTOR')
  async getProfile(@Request() req) {
    return this.doctorService.getProfile(req.user.userId);
  }
}
