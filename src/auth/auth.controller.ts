import { Controller, Post, Body, HttpCode, HttpStatus, UseGuards, Get, Request } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RequestPasswordResetDto, VerifyResetCodeDto, VerifyCodeOnlyDto } from './dto/password-reset.dto';
import { SocialLoginDto } from './dto/social-login.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  async getProfile(@Request() req) {
    return {
      user: req.user,
      message: 'Perfil obtenido exitosamente',
    };
  }

  @UseGuards(JwtAuthGuard)
  @Get('validate')
  async validateToken(@Request() req) {
    return {
      valid: true,
      user: req.user,
      message: 'Token válido',
    };
  }

  @Post('password-reset/request')
  @HttpCode(HttpStatus.OK)
  async requestPasswordReset(@Body() requestPasswordResetDto: RequestPasswordResetDto) {
    console.log('🔵 Password reset request received:', requestPasswordResetDto);
    try {
      const result = await this.authService.requestPasswordReset(requestPasswordResetDto);
      console.log('✅ Password reset request successful:', result);
      return result;
    } catch (error) {
      console.error('❌ Password reset request error:', error);
      throw error;
    }
  }

  @Post('password-reset/verify-code')
  @HttpCode(HttpStatus.OK)
  async verifyCodeOnly(@Body() verifyCodeOnlyDto: VerifyCodeOnlyDto) {
    return this.authService.verifyCodeOnly(verifyCodeOnlyDto);
  }

  @Post('password-reset/verify')
  @HttpCode(HttpStatus.OK)
  async verifyResetCode(@Body() verifyResetCodeDto: VerifyResetCodeDto) {
    return this.authService.verifyResetCodeAndChangePassword(verifyResetCodeDto);
  }

  @Post('social-login')
  @HttpCode(HttpStatus.OK)
  async socialLogin(@Body() socialLoginDto: SocialLoginDto) {
    return this.authService.socialLogin(socialLoginDto);
  }

  @Post('update-role')
  @HttpCode(HttpStatus.OK)
  async updateUserRole(@Body() updateRoleDto: UpdateRoleDto) {
    return this.authService.updateUserRole(updateRoleDto);
  }
}
