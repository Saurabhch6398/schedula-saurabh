import { IsString, IsOptional } from 'class-validator';

export class ShrinkOverrideDto {
  @IsOptional()
  @IsString()
  startTime?: string;

  @IsOptional()
  @IsString()
  endTime?: string;
}
