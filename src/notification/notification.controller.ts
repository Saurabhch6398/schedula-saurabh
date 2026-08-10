import {
  Controller,
  Get,
  Patch,
  Param,
  UseGuards,
  Request,
  ParseIntPipe,
} from '@nestjs/common';
import { NotificationService } from './notification.service';
import { AuthGuard } from '../auth/guards/auth.guard';

interface RequestWithUser {
  user: {
    userId: number;
    email: string;
    role: string;
  };
}

@Controller(['notifications', 'notification'])
@UseGuards(AuthGuard)
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  async getNotifications(@Request() req: RequestWithUser) {
    const data = await this.notificationService.getNotifications(
      req.user.userId,
    );
    return {
      success: true,
      data,
    };
  }

  @Patch(':id/read')
  async markAsRead(
    @Request() req: RequestWithUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const data = await this.notificationService.markAsRead(req.user.userId, id);
    return {
      success: true,
      message: 'Notification marked as read successfully',
      data,
    };
  }
}
