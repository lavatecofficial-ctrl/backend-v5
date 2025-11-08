import { Injectable, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, MoreThanOrEqual, LessThan } from 'typeorm';
import { User } from '../entities/user.entity';
import { UpdateUserPlanDto } from './dto/update-user-plan.dto';

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  async getAllUsers(page: number = 1, limit: number = 10, search?: string) {
    try {
      const skip = (page - 1) * limit;
      
      let whereCondition = {};
      if (search) {
        whereCondition = [
          { fullName: Like(`%${search}%`) },
          { email: Like(`%${search}%`) }
        ];
      }

      const [users, total] = await this.userRepository.findAndCount({
        where: whereCondition,
        order: { createdAt: 'DESC' },
        skip,
        take: limit,
        select: [
          'id', 'fullName', 'email', 'role', 
          'planStartDate', 'planEndDate', 'isEmailVerified', 
          'lastLoginAt', 'createdAt', 'updatedAt'
        ]
      });

      return {
        users,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        message: 'Usuarios obtenidos exitosamente'
      };
    } catch (error) {
      console.error('Error obteniendo usuarios:', error);
      throw new BadRequestException('Error al obtener usuarios');
    }
  }

  async getUserStats() {
    try {
      const totalUsers = await this.userRepository.count();
      const adminUsers = await this.userRepository.count({ where: { role: 'admin' } });
      const superAdminUsers = await this.userRepository.count({ where: { role: 'superadmin' } });
      const regularUsers = await this.userRepository.count({ where: { role: 'user' } });

      const activeUsers = await this.userRepository.count({ 
        where: { 
          planStartDate: MoreThanOrEqual(new Date()),
          planEndDate: MoreThanOrEqual(new Date())
        } 
      });
      const expiredUsers = await this.userRepository.count({ 
        where: { 
          planEndDate: LessThan(new Date())
        } 
      });
      const freeUsers = totalUsers - activeUsers - expiredUsers;

      const verifiedUsers = await this.userRepository.count({ where: { isEmailVerified: true } });
      const unverifiedUsers = await this.userRepository.count({ where: { isEmailVerified: false } });

      // Usuarios registrados en los últimos 30 días
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const recentUsers = await this.userRepository.count({
        where: {
          createdAt: MoreThanOrEqual(thirtyDaysAgo)
        }
      });

      return {
        totalUsers,
        usersByRole: {
          admin: adminUsers,
          superadmin: superAdminUsers,
          user: regularUsers
        },
        usersByStatus: {
          free: freeUsers,
          active: activeUsers,
          expired: expiredUsers
        },
        verification: {
          verified: verifiedUsers,
          unverified: unverifiedUsers
        },
        recentUsers,
        message: 'Estadísticas obtenidas exitosamente'
      };
    } catch (error) {
      console.error('Error obteniendo estadísticas:', error);
      throw new BadRequestException('Error al obtener estadísticas');
    }
  }

  async updateUserPlan(updateUserPlanDto: UpdateUserPlanDto) {
    const { userId, planStartDate, planEndDate } = updateUserPlanDto;
    
    try {
      const user = await this.userRepository.findOne({ where: { id: userId } });
      
      if (!user) {
        throw new BadRequestException('Usuario no encontrado');
      }
      
      user.planStartDate = planStartDate ? new Date(planStartDate) : null;
      user.planEndDate = planEndDate ? new Date(planEndDate) : null;
      
      await this.userRepository.save(user);
      
      return {
        user,
        message: 'Plan de usuario actualizado exitosamente'
      };
    } catch (error) {
      console.error('Error actualizando plan de usuario:', error);
      throw new BadRequestException('Error al actualizar el plan del usuario');
    }
  }

  async deleteUser(userId: string) {
    try {
      const user = await this.userRepository.findOne({ where: { id: userId } });
      
      if (!user) {
        throw new BadRequestException('Usuario no encontrado');
      }

      if (user.role === 'superadmin') {
        throw new ForbiddenException('No se puede eliminar un superadministrador');
      }

      await this.userRepository.remove(user);

      return {
        message: 'Usuario eliminado exitosamente'
      };
    } catch (error) {
      console.error('Error eliminando usuario:', error);
      throw new BadRequestException('Error al eliminar usuario');
    }
  }
}
