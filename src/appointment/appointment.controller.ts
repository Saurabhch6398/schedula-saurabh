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
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AppointmentService } from './appointment.service';
import { ReminderService } from './reminder.service';
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
  constructor(
    private readonly appointmentService: AppointmentService,
    private readonly reminderService: ReminderService,
  ) {}

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

  @Get('me')
  @Roles('PATIENT')
  async getMyAppointmentsMe(@Request() req: RequestWithUser) {
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

  @Post(':id/accept-reschedule')
  @Roles('PATIENT')
  @HttpCode(HttpStatus.OK)
  async acceptReschedule(
    @Request() req: RequestWithUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const data = await this.appointmentService.acceptReschedule(
      req.user.userId,
      id,
    );
    return {
      success: true,
      message: 'Rescheduled appointment accepted successfully',
      data,
    };
  }

  @Post(':id/reject-reschedule')
  @Roles('PATIENT')
  @HttpCode(HttpStatus.OK)
  async rejectReschedule(
    @Request() req: RequestWithUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const data = await this.appointmentService.rejectReschedule(
      req.user.userId,
      id,
    );
    return {
      success: true,
      message: 'Rescheduled appointment rejected and cancelled successfully',
      data,
    };
  }

  @Post('waitlist')
  @Roles('PATIENT')
  async joinWaitlist(
    @Request() req: RequestWithUser,
    @Body() dto: { doctorId: number },
  ) {
    const data = await this.appointmentService.joinWaitlist(
      req.user.userId,
      dto.doctorId,
    );
    return {
      success: true,
      message: 'Successfully joined the waitlist',
      data,
    };
  }

  @Post('waitlist/:queueId/accept')
  @Roles('PATIENT')
  @HttpCode(HttpStatus.OK)
  async acceptWaitlistOffer(
    @Request() req: RequestWithUser,
    @Param('queueId', ParseIntPipe) queueId: number,
  ) {
    const data = await this.appointmentService.acceptWaitlistOffer(
      req.user.userId,
      queueId,
    );
    return {
      success: true,
      message: 'Waitlist offer accepted and appointment booked successfully',
      data,
    };
  }

  @Post('waitlist/:queueId/reject')
  @Roles('PATIENT')
  @HttpCode(HttpStatus.OK)
  async rejectWaitlistOffer(
    @Request() req: RequestWithUser,
    @Param('queueId', ParseIntPipe) queueId: number,
  ) {
    const data = await this.appointmentService.rejectWaitlistOffer(
      req.user.userId,
      queueId,
    );
    return {
      success: true,
      message: 'Waitlist offer rejected successfully',
      data,
    };
  }

  @Post('reminders/trigger')
  @Roles('PATIENT', 'DOCTOR')
  @HttpCode(HttpStatus.OK)
  async triggerReminders() {
    const sent = await this.reminderService.checkReminders();
    return {
      success: true,
      message: `${sent} reminders generated successfully`,
      data: { sent },
    };
  }
}
