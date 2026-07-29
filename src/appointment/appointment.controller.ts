import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  UseGuards,
  Request,
  ParseIntPipe,
} from '@nestjs/common';
import { AppointmentService } from './appointment.service';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { BookAppointmentDto } from './dto/book-appointment.dto';
import { RescheduleAppointmentDto } from './dto/reschedule-appointment.dto';
import { CompleteAppointmentDto } from './dto/complete-appointment.dto';

interface RequestWithUser {
  user: {
    userId: number;
    email: string;
    role: string;
  };
}

@Controller(['appointments', 'appointment'])
@UseGuards(AuthGuard, RolesGuard)
export class AppointmentController {
  constructor(private readonly appointmentService: AppointmentService) {}

  @Post()
  @Roles('PATIENT')
  async bookAppointment(
    @Request() req: RequestWithUser,
    @Body() dto: BookAppointmentDto,
  ) {
    const data = await this.appointmentService.bookAppointment(
      req.user.userId,
      dto,
    );
    return {
      success: true,
      message: 'Appointment booked successfully',
      data,
    };
  }

  @Get('my')
  @Roles('PATIENT')
  async getMyAppointments(@Request() req: RequestWithUser) {
    const data = await this.appointmentService.getMyAppointments(
      req.user.userId,
    );
    return {
      success: true,
      data,
    };
  }

  @Get('upcoming')
  @Roles('PATIENT')
  async getUpcomingAppointments(@Request() req: RequestWithUser) {
    const data = await this.appointmentService.getMyAppointments(
      req.user.userId,
      { upcoming: true },
    );
    return {
      success: true,
      data,
    };
  }

  @Get('history')
  @Roles('PATIENT')
  async getAppointmentHistory(@Request() req: RequestWithUser) {
    const data = await this.appointmentService.getMyAppointments(
      req.user.userId,
      { history: true },
    );
    return {
      success: true,
      data,
    };
  }

  @Patch(':id/cancel')
  @Roles('PATIENT')
  async cancelAppointment(
    @Request() req: RequestWithUser,
    @Param('id', ParseIntPipe) id: number,
    @Body('cancellationReason') reason?: string,
  ) {
    const data = await this.appointmentService.cancelAppointment(
      req.user.userId,
      id,
      reason,
    );
    return {
      success: true,
      message: 'Appointment cancelled successfully',
      data,
    };
  }

  @Patch(':id/reschedule')
  @Roles('PATIENT')
  async rescheduleAppointment(
    @Request() req: RequestWithUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RescheduleAppointmentDto,
  ) {
    const data = await this.appointmentService.rescheduleAppointment(
      req.user.userId,
      id,
      dto,
    );
    return {
      success: true,
      message: 'Appointment rescheduled successfully',
      data,
    };
  }

  @Patch(':id/complete')
  @Roles('DOCTOR')
  async completeAppointment(
    @Request() req: RequestWithUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CompleteAppointmentDto,
  ) {
    const data = await this.appointmentService.completeAppointment(
      req.user.userId,
      id,
      dto,
    );
    return {
      success: true,
      message: 'Appointment completed successfully',
      data,
    };
  }

  @Get(':id')
  @Roles('DOCTOR', 'PATIENT')
  async getAppointmentDetails(
    @Request() req: RequestWithUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const data = await this.appointmentService.getAppointmentDetails(
      req.user.userId,
      id,
    );
    return {
      success: true,
      data,
    };
  }
}
