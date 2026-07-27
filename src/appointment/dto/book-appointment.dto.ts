import { IsNotEmpty, IsOptional, IsString, IsInt } from 'class-validator';

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
}

