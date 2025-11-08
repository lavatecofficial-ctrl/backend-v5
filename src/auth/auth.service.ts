import { Injectable, UnauthorizedException, ConflictException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User } from '../entities/user.entity';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RequestPasswordResetDto, VerifyResetCodeDto, VerifyCodeOnlyDto } from './dto/password-reset.dto';
import { SocialLoginDto } from './dto/social-login.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { EmailService } from '../services/email.service';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private jwtService: JwtService,
    private emailService: EmailService,
  ) {}

  async register(registerDto: RegisterDto) {
    const { fullName, email, password } = registerDto;

    // Verificar si el usuario ya existe
    const existingUser = await this.userRepository.findOne({
      where: { email },
    });

    if (existingUser) {
      throw new ConflictException('El email ya está registrado');
    }

    // Encriptar la contraseña
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Crear el nuevo usuario
    const user = this.userRepository.create({
      fullName,
      email,
      password: hashedPassword,
    });

    // Guardar el usuario
    const savedUser = await this.userRepository.save(user);

    // Generar token JWT
    const payload = { 
      sub: savedUser.id, 
      email: savedUser.email,
      role: savedUser.role
    };
    const token = this.jwtService.sign(payload);

    // Retornar respuesta sin la contraseña
    const { password: _, ...userWithoutPassword } = savedUser;

    return {
      user: userWithoutPassword,
      token,
      message: 'Usuario registrado exitosamente',
    };
  }

  async login(loginDto: LoginDto) {
    const { email, password } = loginDto;

    // Buscar el usuario por email
    const user = await this.userRepository.findOne({
      where: { email },
    });

    if (!user) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    // Verificar la contraseña
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    // Actualizar último login
    user.lastLoginAt = new Date();
    await this.userRepository.save(user);

    // Generar token JWT
    const payload = { 
      sub: user.id, 
      email: user.email,
      role: user.role
    };
    const token = this.jwtService.sign(payload);

    // Retornar respuesta sin la contraseña
    const { password: _, ...userWithoutPassword } = user;

    return {
      user: userWithoutPassword,
      token,
      message: 'Login exitoso',
    };
  }

  async validateUser(id: string): Promise<User> {
    const user = await this.userRepository.findOne({
      where: { id },
    });

    if (!user) {
      throw new UnauthorizedException('Usuario no encontrado');
    }

    return user;
  }

  // Generar código de 6 dígitos
  private generateResetCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  async requestPasswordReset(requestPasswordResetDto: RequestPasswordResetDto) {
    const { email } = requestPasswordResetDto;
    console.log('🔍 Looking for user with email:', email);

    // Verificar si el usuario existe
    const user = await this.userRepository.findOne({
      where: { email },
    });
    
    console.log('👤 User found:', user ? 'Yes' : 'No');

    if (!user) {
      // Por seguridad, no revelamos si el email existe o no
      return {
        message: 'Si el email está registrado, recibirás un código de recuperación',
      };
    }

    // Generar nuevo código
    const code = this.generateResetCode();
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 10); // Código válido por 10 minutos

    // Actualizar el usuario con el nuevo código
    user.resetCode = code;
    user.resetCodeExpiresAt = expiresAt;
    user.resetCodeUsed = false;

    await this.userRepository.save(user);

    // Enviar email con el código
    console.log('📧 Sending email with code:', code);
    try {
      await this.emailService.sendPasswordResetCode(email, code);
      console.log('✅ Email sent successfully');
    } catch (error) {
      console.error('❌ Email sending failed:', error);
      // Si falla el envío del email, limpiar el código del usuario
      user.resetCode = null;
      user.resetCodeExpiresAt = null;
      user.resetCodeUsed = false;
      await this.userRepository.save(user);
      throw new BadRequestException('Error enviando el email. Intenta nuevamente.');
    }

    return {
      message: 'Si el email está registrado, recibirás un código de recuperación',
    };
  }

  async verifyCodeOnly(verifyCodeOnlyDto: VerifyCodeOnlyDto) {
    const { email, code } = verifyCodeOnlyDto;
    console.log('🔍 Verifying code only for email:', email, 'code:', code);

    // Buscar el usuario con código válido
    const user = await this.userRepository.findOne({
      where: {
        email,
        resetCode: code,
        resetCodeUsed: false,
        resetCodeExpiresAt: MoreThan(new Date()),
      },
    });

    if (!user) {
      console.log('❌ Invalid or expired code');
      throw new BadRequestException('Código inválido o expirado');
    }

    console.log('✅ Code verified successfully');
    return {
      message: 'Código verificado correctamente',
    };
  }

  async verifyResetCodeAndChangePassword(verifyResetCodeDto: VerifyResetCodeDto) {
    const { email, code, new_password } = verifyResetCodeDto;

    // Buscar el usuario con código válido
    const user = await this.userRepository.findOne({
      where: {
        email,
        resetCode: code,
        resetCodeUsed: false,
        resetCodeExpiresAt: MoreThan(new Date()),
      },
    });

    if (!user) {
      throw new BadRequestException('Código inválido o expirado');
    }

    // Encriptar la nueva contraseña
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(new_password, saltRounds);

    // Actualizar la contraseña del usuario y limpiar código
    user.password = hashedPassword;
    user.resetCode = null;
    user.resetCodeExpiresAt = null;
    user.resetCodeUsed = true; // Marcar como usado por seguridad

    await this.userRepository.save(user);

    return {
      message: 'Contraseña actualizada exitosamente',
    };
  }

  async socialLogin(socialLoginDto: SocialLoginDto) {
    const { provider, email, name, picture, providerId } = socialLoginDto;

    try {
      // Buscar usuario existente por email
      let user = await this.userRepository.findOne({
        where: { email }
      });

      if (user) {
        // Usuario existe, actualizar información social
        if (provider === 'google') {
          user.googleId = providerId;
        } else if (provider === 'facebook') {
          user.facebookId = providerId;
        }
        
        if (picture) {
          user.profilePicture = picture;
        }
        
        user.lastLoginAt = new Date();
        await this.userRepository.save(user);
      } else {
        // Crear nuevo usuario desde datos sociales
        user = this.userRepository.create({
          fullName: name,
          email,
          password: '', // Password vacío para usuarios sociales
          isEmailVerified: true, // Consideramos verificado por el proveedor social
          profilePicture: picture,
          lastLoginAt: new Date(),
          googleId: provider === 'google' ? providerId : null,
          facebookId: provider === 'facebook' ? providerId : null
        });
        
        await this.userRepository.save(user);
      }

      // Generar token JWT
      const payload = { 
        sub: user.id, 
        email: user.email, 
        fullName: user.fullName,
        role: user.role
      };
      
      const token = this.jwtService.sign(payload);

      return {
        user: {
          id: user.id,
          fullName: user.fullName,
          email: user.email,
          isEmailVerified: user.isEmailVerified,
          lastLoginAt: user.lastLoginAt,
          role: user.role,
          planStartDate: user.planStartDate,
          planEndDate: user.planEndDate,
          profilePicture: user.profilePicture,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        },
        token,
        message: `Login exitoso con ${provider}`,
      };
    } catch (error) {
      console.error('Error en login social:', error);
      throw new BadRequestException('Error en autenticación social');
    }
  }

  async updateUserRole(updateRoleDto: UpdateRoleDto) {
    const { email, role } = updateRoleDto;

    try {
      // Buscar usuario por email
      const user = await this.userRepository.findOne({
        where: { email }
      });

      if (!user) {
        throw new BadRequestException('Usuario no encontrado');
      }

      // Actualizar rol
      user.role = role;
      await this.userRepository.save(user);

      // Retornar respuesta sin la contraseña
      const { password: _, ...userWithoutPassword } = user;

      return {
        user: userWithoutPassword,
        message: `Rol actualizado a ${role} exitosamente`,
      };
    } catch (error) {
      console.error('Error actualizando rol:', error);
      throw new BadRequestException('Error al actualizar el rol del usuario');
    }
  }
}
