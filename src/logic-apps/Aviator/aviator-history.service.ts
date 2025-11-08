import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AviatorRound } from '../../entities/aviator-round.entity';

export interface AviatorHistoryItem {
  id: number;
  roundId: string;
  maxMultiplier: number;
  totalBetAmount: number;
  totalCashout: number;
  casinoProfit: number;
  betsCount: number;
  onlinePlayers: number;
  createdAt: Date;
}

@Injectable()
export class AviatorHistoryService {
  constructor(
    @InjectRepository(AviatorRound)
    private aviatorRoundRepository: Repository<AviatorRound>,
  ) {}

  async getRecentRounds(bookmakerId: number, limit: number = 100): Promise<AviatorHistoryItem[]> {
    try {
      // Primero traer las últimas N rondas (DESC), luego invertir para ASC
      const rounds = await this.aviatorRoundRepository
        .createQueryBuilder('round')
        .where('round.bookmakerId = :bookmakerId', { bookmakerId })
        .orderBy('round.createdAt', 'DESC') // Traer las más recientes primero
        .limit(limit)
        .getMany();

      // Mapear y revertir para que queden en orden ASC (más antigua primero, más reciente al final)
      const mapped = rounds.map(round => ({
        id: round.id,
        roundId: round.roundId,
        maxMultiplier: parseFloat(round.maxMultiplier.toString()),
        totalBetAmount: parseFloat(round.totalBetAmount.toString()),
        totalCashout: parseFloat(round.totalCashout.toString()),
        casinoProfit: parseFloat(round.casinoProfit.toString()),
        betsCount: round.betsCount,
        onlinePlayers: round.onlinePlayers,
        createdAt: round.createdAt
      }));
      
      return mapped.reverse(); // Invertir para orden ASC
    } catch (error) {
      console.error('Error fetching recent rounds:', error);
      return [];
    }
  }

  async getRecentRoundsForAllBookmakers(limit: number = 100): Promise<AviatorHistoryItem[]> {
    try {
      const rounds = await this.aviatorRoundRepository
        .createQueryBuilder('round')
        .select([
          'round.id',
          'round.roundId',
          'round.maxMultiplier',
          'round.totalBetAmount',
          'round.totalCashout',
          'round.casinoProfit',
          'round.betsCount',
          'round.onlinePlayers',
          'round.createdAt'
        ])
        .orderBy('round.createdAt', 'DESC')
        .limit(limit)
        .getMany();

      return rounds.map(round => ({
        id: round.id,
        roundId: round.roundId,
        maxMultiplier: parseFloat(round.maxMultiplier.toString()),
        totalBetAmount: parseFloat(round.totalBetAmount.toString()),
        totalCashout: parseFloat(round.totalCashout.toString()),
        casinoProfit: parseFloat(round.casinoProfit.toString()),
        betsCount: round.betsCount,
        onlinePlayers: round.onlinePlayers,
        createdAt: round.createdAt
      }));
    } catch (error) {
      console.error('Error fetching recent rounds for all bookmakers:', error);
      return [];
    }
  }
}
