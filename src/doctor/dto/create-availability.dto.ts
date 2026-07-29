import { IsNotEmpty, IsString, IsIn } from 'class-validator';

export class CreateAvailabilityDto {
  @IsNotEmpty({ message: 'Day of week is required' })
  @IsString()
  @IsIn(
    ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'],
    { message: 'dayOfWeek must be a valid uppercase day of the week' },
  )
  dayOfWeek: string;

  @IsNotEmpty({ message: 'Start time is required' })
  @IsString()
  startTime: string;

  @IsNotEmpty({ message: 'End time is required' })
  @IsString()
  endTime: string;
}
