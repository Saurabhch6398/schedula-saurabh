import { IsOptional, IsString } from 'class-validator';

export class RescheduleAppointmentDto {
  @IsOptional()
  @IsString()
  date?: string;

  @IsOptional()
  @IsString()
  newDate?: string;

  @IsOptional()
  @IsString()
  slot?: string;

  @IsOptional()
  @IsString()
  slotId?: string;

  @IsOptional()
  @IsString()
  newSlotId?: string;

  @IsOptional()
  @IsString()
  startTime?: string;

  @IsOptional()
  @IsString()
  endTime?: string;

  @IsOptional()
  waveId?: number;
}
