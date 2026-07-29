import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  ParseIntPipe,
} from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AvailabilityService } from './availability.service';
import { CreateAvailabilityDto } from './dto/create-availability.dto';
import { UpdateAvailabilityDto } from './dto/update-availability.dto';
import { CreateOverrideDto } from './dto/create-override.dto';

interface RequestWithUser {
  user: {
    userId: number;
    email: string;
    role: string;
  };
}

@Controller('doctor/availability')
@UseGuards(AuthGuard, RolesGuard)
export class AvailabilityController {
  constructor(private readonly availabilityService: AvailabilityService) {}

  // 1. Static GET routes
  @Get('date')
  @Roles('DOCTOR', 'PATIENT')
  async getAvailabilityForDate(
    @Request() req: RequestWithUser,
    @Query('date') date: string,
    @Query('doctorId') doctorId?: string,
  ) {
    const parsedDoctorId = doctorId ? parseInt(doctorId, 10) : undefined;
    return this.availabilityService.getAvailabilityForDate(
      date,
      parsedDoctorId,
      req.user.userId,
    );
  }

  @Get()
  @Roles('DOCTOR')
  async getRecurring(@Request() req: RequestWithUser) {
    return this.availabilityService.getRecurring(req.user.userId);
  }

  // 2. Static POST routes
  @Post('override')
  @Roles('DOCTOR')
  async createOverride(
    @Request() req: RequestWithUser,
    @Body() dto: CreateOverrideDto,
  ) {
    return this.availabilityService.createOverride(req.user.userId, dto);
  }

  @Post()
  @Roles('DOCTOR')
  async createRecurring(
    @Request() req: RequestWithUser,
    @Body() dto: CreateAvailabilityDto,
  ) {
    return this.availabilityService.createRecurring(req.user.userId, dto);
  }

  // 3. Static DELETE routes
  @Delete('override')
  @Roles('DOCTOR')
  async deleteOverride(
    @Request() req: RequestWithUser,
    @Query('date') date: string,
  ) {
    return this.availabilityService.deleteOverride(req.user.userId, date);
  }

  // 4. Parameterized routes
  @Patch(':id')
  @Roles('DOCTOR')
  async updateRecurring(
    @Request() req: RequestWithUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAvailabilityDto,
  ) {
    return this.availabilityService.updateRecurring(req.user.userId, id, dto);
  }

  @Delete(':id')
  @Roles('DOCTOR')
  async deleteRecurring(
    @Request() req: RequestWithUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.availabilityService.deleteRecurring(req.user.userId, id);
  }
}
