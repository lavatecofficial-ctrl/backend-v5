import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class WsAuthGuard implements CanActivate {
  constructor(private jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      const client: Socket = context.switchToWs().getClient();
      
      // Obtener el token del handshake o de los headers
      const token = this.extractToken(client);
      
      if (!token) {
        throw new WsException('Token no proporcionado');
      }

      // Verificar el token
      const payload = await this.jwtService.verifyAsync(token);
      
      // Agregar el usuario al socket para uso posterior
      client.data.user = payload;
      
      return true;
    } catch (error) {
      throw new WsException('Token inválido');
    }
  }

  private extractToken(client: Socket): string | undefined {
    // Intentar obtener el token de diferentes lugares
    const auth = client.handshake.auth?.token || 
                 client.handshake.headers?.authorization ||
                 client.handshake.query?.token;

    if (typeof auth === 'string') {
      // Si viene como "Bearer token", extraer solo el token
      const token = auth.replace('Bearer ', '');
      return token;
    }
    return undefined;
  }
}
