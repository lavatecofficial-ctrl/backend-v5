import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AviatorWs } from '../../entities/aviator-ws.entity';

@Injectable()
export class AviatorService {
  constructor(
    @InjectRepository(AviatorWs)
    private aviatorWsRepository: Repository<AviatorWs>,
  ) {}

  async findAll(): Promise<AviatorWs[]> {
    return this.aviatorWsRepository.find({
      relations: ['bookmaker', 'game'],
      order: { id: 'ASC' },
    });
  }

  async findById(id: number): Promise<AviatorWs | null> {
    return this.aviatorWsRepository.findOne({
      where: { id },
      relations: ['bookmaker', 'game'],
    });
  }

  async findByBookmakerId(bookmakerId: number): Promise<AviatorWs | null> {
    return this.aviatorWsRepository.findOne({
      where: { bookmakerId },
      relations: ['bookmaker', 'game'],
    });
  }

  async updateWebSocketUrl(bookmakerId: number, url: string): Promise<AviatorWs> {
    const aviatorWs = await this.findByBookmakerId(bookmakerId);
    if (!aviatorWs) {
      throw new Error('Aviator WebSocket no encontrado para este bookmaker');
    }
    
    aviatorWs.url_websocket = url;
    return this.aviatorWsRepository.save(aviatorWs);
  }

  async updateAuthMessage(bookmakerId: number, authMessage: string): Promise<AviatorWs> {
    const aviatorWs = await this.findByBookmakerId(bookmakerId);
    if (!aviatorWs) {
      throw new Error('Aviator WebSocket no encontrado para este bookmaker');
    }
    
    aviatorWs.auth_message = authMessage;
    return this.aviatorWsRepository.save(aviatorWs);
  }

  async updateAuthMessageById(id: number, authMessage: string): Promise<AviatorWs> {
    const aviatorWs = await this.findById(id);
    if (!aviatorWs) {
      throw new Error('Aviator WebSocket no encontrado');
    }
    
    aviatorWs.auth_message = authMessage;
    return this.aviatorWsRepository.save(aviatorWs);
  }

  async updateWebSocketUrlById(id: number, url: string): Promise<AviatorWs> {
    const aviatorWs = await this.findById(id);
    if (!aviatorWs) {
      throw new Error('Aviator WebSocket no encontrado');
    }
    
    aviatorWs.url_websocket = url;
    return this.aviatorWsRepository.save(aviatorWs);
  }

  async updateWebSocketStatus(bookmakerId: number, status: string): Promise<AviatorWs> {
    const aviatorWs = await this.findByBookmakerId(bookmakerId);
    if (!aviatorWs) {
      throw new Error('Aviator WebSocket no encontrado para este bookmaker');
    }
    
    aviatorWs.status_ws = status;
    return this.aviatorWsRepository.save(aviatorWs);
  }
}
