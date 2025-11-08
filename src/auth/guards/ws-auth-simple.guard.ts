import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';

@Injectable()
export class WsAuthSimpleGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      const client: Socket = context.switchToWs().getClient();
      
      // Por ahora, permitir todas las conexiones sin autenticación
      // En producción, aquí iría la lógica de autenticación
      console.log(`Cliente conectado sin autenticación: ${client.id}`);
      
      return true;
    } catch (error) {
      throw new WsException('Error de autenticación');
    }
  }
}
