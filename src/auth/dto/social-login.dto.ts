import { IsString, IsEmail, IsEnum, IsOptional } from 'class-validator';

export class SocialLoginDto {
  @IsEnum(['google', 'facebook'])
  provider: 'google' | 'facebook';

  @IsEmail()
  email: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  picture?: string;

  @IsString()
  providerId: string;
}
