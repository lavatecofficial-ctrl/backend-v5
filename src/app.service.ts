import { Injectable, OnModuleInit } from '@nestjs/common';
import { RouletteWebSocketService } from './logic-apps/Roulettes/roulette-websocket.service';

@Injectable()
export class AppService implements OnModuleInit {
  constructor(
    private rouletteWebSocketService: RouletteWebSocketService,
  ) {}

  async onModuleInit() {
    // Inicializar conexiones WebSocket para Ruleta
    try {
      await this.rouletteWebSocketService.initializeConnections(null);
    } catch (error) {
      console.error('Error initializing WebSocket connections:', error);
    }
  }

  getHello(): string {
    return 'Hello World!';
  }
}
