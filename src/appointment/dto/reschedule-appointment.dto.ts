import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class RescheduleAppointmentDto {
  @IsNotEmpty({ message: 'Date is required' })
  @IsString()
  date: string;

  @IsOptional()
  @IsString()
  slot?: string;

  @IsOptional()
  @IsString()
  startTime?: string;

  @IsOptional()
  @IsString()
  endTime?: string;
}
