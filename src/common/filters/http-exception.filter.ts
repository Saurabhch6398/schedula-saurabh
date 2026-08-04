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
    const errorResponse: Record<string, any> = {
      success: false,
      message: 'Internal server error',
    };

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const resContent = exception.getResponse();
      if (
        typeof resContent === 'object' &&
        resContent !== null
      ) {
        Object.assign(errorResponse, resContent);
        const msg = (resContent as any).message;
        if (Array.isArray(msg)) {
          errorResponse.message = msg.join(', ');
        } else if (typeof msg === 'string') {
          errorResponse.message = msg;
        } else {
          errorResponse.message = exception.message;
        }
      } else if (typeof resContent === 'string') {
        errorResponse.message = resContent;
      } else {
        errorResponse.message = exception.message;
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
        errorResponse.message = 'Slot already booked';
      } else {
        errorResponse.message = errMsg;
      }
    }

    errorResponse.success = false;

    response.status(status).json(errorResponse);
  }
}
