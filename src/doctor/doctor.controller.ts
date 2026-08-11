import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  UseGuards,
  Request,
  Param,
  Query,
  ParseIntPipe,
} from '@nestjs/common';
import { DoctorService } from './doctor.service';
import { AvailabilityService } from './availability.service';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateDoctorProfileDto } from './dto/create-doctor-profile.dto';
import { UpdateDoctorProfileDto } from './dto/update-doctor-profile.dto';
import { SelectSchedulingDto } from './dto/select-scheduling.dto';
import { AppointmentService } from '../appointment/appointment.service';

interface RequestWithUser {
  user: {
    userId: number;
    email: string;
    role: string;
  };
}

@Controller('doctor')
@UseGuards(AuthGuard, RolesGuard)
export class DoctorController {
  constructor(
    private readonly doctorService: DoctorService,
    private readonly availabilityService: AvailabilityService,
    private readonly appointmentService: AppointmentService,
  ) {}

  @Post('profile')
  @Roles('DOCTOR')
  async createProfile(
    @Request() req: RequestWithUser,
    @Body() dto: CreateDoctorProfileDto,
  ) {
    return this.doctorService.createProfile(req.user.userId, dto);
  }

  @Get('profile')
  @Roles('DOCTOR')
  async getProfile(@Request() req: RequestWithUser) {
    return this.doctorService.getProfile(req.user.userId);
  }

  @Patch('profile')
  @Roles('DOCTOR')
  async updateProfile(
    @Request() req: RequestWithUser,
    @Body() dto: UpdateDoctorProfileDto,
  ) {
    return this.doctorService.updateProfile(req.user.userId, dto);
  }

  @Patch('scheduling')
  @Roles('DOCTOR')
  async updateScheduling(
    @Request() req: RequestWithUser,
    @Body() dto: SelectSchedulingDto,
  ) {
    return this.doctorService.updateScheduling(req.user.userId, dto);
  }

  @Get(':id/slots')
  @Roles('DOCTOR', 'PATIENT')
  async getSlots(
    @Param('id', ParseIntPipe) doctorId: number,
    @Query('date') date: string,
  ) {
    return this.availabilityService.getStreamSlots(doctorId, date);
  }

  @Get(':id/waves')
  @Roles('DOCTOR', 'PATIENT')
  async getWaves(
    @Param('id', ParseIntPipe) doctorId: number,
    @Query('date') date: string,
  ) {
    return this.availabilityService.getWaveWindows(doctorId, date);
  }

  @Get(':id/availability')
  @Roles('DOCTOR', 'PATIENT')
  async getDoctorAvailability(
    @Param('id', ParseIntPipe) doctorId: number,
    @Query('date') date?: string,
  ) {
    if (date) {
      return this.availabilityService.getAvailabilityForDate(date, doctorId);
    }
    return this.availabilityService.getDoctorAllAvailability(doctorId);
  }

  @Get('appointments')
  @Roles('DOCTOR')
  async getDoctorAppointments(
    @Request() req: RequestWithUser,
    @Query('date') date?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sort') sort?: string,
  ) {
    const data = await this.appointmentService.getDoctorAppointments(
      req.user.userId,
      {
        date,
        status,
        page: page ? parseInt(page, 10) : undefined,
        limit: limit ? parseInt(limit, 10) : undefined,
        sort,
      },
    );
    return {
      success: true,
      data,
    };
  }
}

@Controller('patient/doctors')
@UseGuards(AuthGuard, RolesGuard)
@Roles('PATIENT')
export class PatientDoctorController {
  constructor(private readonly doctorService: DoctorService) {}

  @Get()
  async getAllDoctors() {
    return this.doctorService.getAllDoctors();
  }
}

