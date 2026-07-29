import { IsOptional, IsInt, IsString } from 'class-validator';

export class UpdatePatientProfileDto {
  @IsOptional()
  @IsString()
  fullName?: string;

  @IsOptional()
  @IsInt({ message: 'Age must be an integer' })
  age?: number;

  @IsOptional()
  @IsString()
  gender?: string;

  @IsOptional()
  @IsString()
  contact?: string;

  @IsOptional()
  @IsString()
  healthInfo?: string;
}
