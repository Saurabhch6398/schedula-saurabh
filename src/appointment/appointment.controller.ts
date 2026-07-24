import {
  Controller,
  Post,
  Get,
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

interface RequestWithUser {
  user: {
    userId: number;
    email: string;
    role: string;
  };
}

@Controller('appointments')
@UseGuards(AuthGuard, RolesGuard)
export class AppointmentController {
  constructor(private readonly appointmentService: AppointmentService) {}

  @Post()
  @Roles('PATIENT')
  async bookAppointment(
    @Request() req: RequestWithUser,
    @Body() dto: BookAppointmentDto,
  ) {
    return this.appointmentService.bookAppointment(req.user.userId, dto);
  }

  @Get(':id')
  @Roles('DOCTOR', 'PATIENT')
  async getAppointmentDetails(
    @Request() req: RequestWithUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.appointmentService.getAppointmentDetails(req.user.userId, id);
  }
}
