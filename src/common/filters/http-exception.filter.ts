import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const resContent = exception.getResponse() as Record<string, unknown>;
      if (
        typeof resContent === 'object' &&
        resContent !== null &&
        'message' in resContent
      ) {
        const msg = resContent.message;
        if (Array.isArray(msg)) {
          message = msg.join(', ');
        } else if (typeof msg === 'string') {
          message = msg;
        } else {
          message = exception.message;
        }
      } else if (typeof resContent === 'string') {
        message = resContent;
      } else {
        message = exception.message;
      }
    } else if (exception instanceof Error) {
      // Catch duplicate key database errors from Prisma or others
      const errMsg = exception.message;
      if (
        errMsg.includes('Unique constraint failed') ||
        errMsg.includes('unique_active_appointment') ||
        errMsg.includes('unique_active_wave_appointment')
      ) {
        status = HttpStatus.CONFLICT;
        message = 'Slot already booked';
      } else {
        message = errMsg;
      }
    }

    response.status(status).json({
      success: false,
      message,
    });
  }
}
