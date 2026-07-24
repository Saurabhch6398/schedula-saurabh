import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class BookAppointmentDto {
  @IsNotEmpty({ message: 'doctorId is required' })
  doctorId: any;

  @IsOptional()
  @IsString()
  slot?: string;

  @IsOptional()
  @IsString()
  date?: string;

  @IsOptional()
  waveId?: any;
}
