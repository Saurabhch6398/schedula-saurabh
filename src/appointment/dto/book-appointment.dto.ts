import { IsNotEmpty, IsOptional, IsString, IsInt, IsIn } from 'class-validator';

export class BookAppointmentDto {
  @IsNotEmpty({ message: 'doctorId is required' })
  @IsInt({ message: 'doctorId must be an integer' })
  doctorId: number;

  @IsOptional()
  @IsString()
  slot?: string;

  @IsOptional()
  @IsString()
  date?: string;

  @IsOptional()
  @IsInt({ message: 'waveId must be an integer' })
  waveId?: number;

  @IsOptional()
  @IsString()
  startTime?: string;

  @IsOptional()
  @IsString()
  endTime?: string;

  @IsOptional()
  @IsString()
  @IsIn(['ONLINE', 'RECEPTION'], {
    message: 'bookingSource must be ONLINE or RECEPTION',
  })
  bookingSource?: string;
}
