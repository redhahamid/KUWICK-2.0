import { IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

// D-038 — waiting-room monitor settings, one per clinic. All optional:
// a PUT only overwrites what it sends.
export class UpdateQueueDisplayConfigDto {
  @IsOptional()
  @IsString()
  youtubeUrl?: string;

  @IsOptional()
  @IsString()
  runningText?: string;

  // Matches a SpeechSynthesisVoice.name on the display machine (D-025).
  @IsOptional()
  @IsString()
  voiceName?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.5)
  @Max(2)
  voiceRate?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  voicePitch?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  voiceVolume?: number;
}
