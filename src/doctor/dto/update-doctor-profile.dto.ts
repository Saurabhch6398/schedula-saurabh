import { IsOptional, IsInt, IsNumber, IsString, IsIn } from 'class-validator';

export class UpdateDoctorProfileDto {
  @IsOptional()
  @IsString()
  fullName?: string;

  @IsOptional()
  @IsString()
  specialization?: string;

  @IsOptional()
  @IsInt({ message: 'Experience must be an integer' })
  experience?: number;

  @IsOptional()
  @IsString()
  qualification?: string;

  @IsOptional()
  @IsNumber({}, { message: 'Consultation Fee must be a number' })
  consultationFee?: number;

  @IsOptional()
  @IsString()
  availability?: string;

  @IsOptional()
  @IsString()
  profileDetails?: string;

  @IsOptional()
  @IsIn(['STREAM', 'WAVE'], {
    message: 'schedulingType must be STREAM or WAVE',
  })
  schedulingType?: 'STREAM' | 'WAVE';

  @IsOptional()
  @IsInt({ message: 'slotDuration must be an integer' })
  slotDuration?: number;

  @IsOptional()
  @IsInt({ message: 'bufferTime must be an integer' })
  bufferTime?: number;
}
