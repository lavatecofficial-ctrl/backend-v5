import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AuthService } from '../auth/auth.service';
import { UpdateUserPlanDto } from './dto/update-user-plan.dto';
import { UpdateRoleDto } from '../auth/dto/update-role.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('admin')
@UseGuards(JwtAuthGuard)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly authService: AuthService
  ) {}

  // Middleware para verificar permisos de admin
  private checkAdminPermissions(userRole: string) {
    if (userRole !== 'admin' && userRole !== 'superadmin') {
      throw new Error('Acceso denegado: Se requieren permisos de administrador');
    }
  }

  @Get('users')
  async getAllUsers(
    @Request() req,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '10',
    @Query('search') search?: string
  ) {
    this.checkAdminPermissions(req.user.role);
    
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 10;
    
    return this.adminService.getAllUsers(pageNum, limitNum, search);
  }

  @Get('stats')
  async getUserStats(@Request() req) {
    this.checkAdminPermissions(req.user.role);
    return this.adminService.getUserStats();
  }

  @Put('users/role')
  async updateUserRole(@Request() req, @Body() updateRoleDto: UpdateRoleDto) {
    this.checkAdminPermissions(req.user.role);
    
    // Solo superadmins pueden crear otros admins o superadmins
    if ((updateRoleDto.role === 'admin' || updateRoleDto.role === 'superadmin') && req.user.role !== 'superadmin') {
      throw new Error('Solo superadministradores pueden asignar roles de administrador');
    }
    
    return this.authService.updateUserRole(updateRoleDto);
  }

  @Put('users/plan')
  async updateUserPlan(@Request() req, @Body() updateUserPlanDto: UpdateUserPlanDto) {
    this.checkAdminPermissions(req.user.role);
    return this.adminService.updateUserPlan(updateUserPlanDto);
  }

  @Delete('users/:id')
  async deleteUser(@Request() req, @Param('id') userId: string) {
    this.checkAdminPermissions(req.user.role);
    
    // Solo superadmins pueden eliminar admins
    const userToDelete = await this.adminService.getAllUsers(1, 1000);
    const targetUser = userToDelete.users.find(u => u.id === userId);
    
    if (targetUser?.role === 'admin' && req.user.role !== 'superadmin') {
      throw new Error('Solo superadministradores pueden eliminar administradores');
    }
    
    return this.adminService.deleteUser(userId);
  }
}
