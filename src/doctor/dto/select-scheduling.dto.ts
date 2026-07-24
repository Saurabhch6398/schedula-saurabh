import { IsNotEmpty, IsInt, IsOptional, IsIn } from 'class-validator';

export class SelectSchedulingDto {
  @IsNotEmpty({ message: 'Type is required' })
  @IsIn(['STREAM', 'WAVE'], {
    message: 'schedulingType must be STREAM or WAVE',
  })
  type: 'STREAM' | 'WAVE';

  @IsOptional()
  @IsInt({ message: 'slotDuration must be an integer' })
  slotDuration?: number;

  @IsOptional()
  @IsInt({ message: 'bufferTime must be an integer' })
  bufferTime?: number;
}
