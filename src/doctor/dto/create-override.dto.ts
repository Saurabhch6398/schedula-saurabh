import { IsNotEmpty, IsString, Matches, IsOptional } from 'class-validator';

export class CreateOverrideDto {
  @IsNotEmpty({ message: 'Date is required' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Date must be in YYYY-MM-DD format' })
  date: string;

  @IsOptional()
  @IsString()
  startTime?: string;

  @IsOptional()
  @IsString()
  endTime?: string;
}
