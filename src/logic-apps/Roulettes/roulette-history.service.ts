import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RouletteRound } from '../../entities/roulette-round.entity';

export interface RouletteHistoryItem {
  id: number;
  bookmakerId: number;
  roundId: string;
  number: number;
  color: string;
  timestamp: string;
  bookmakerName: string;
}

@Injectable()
export class RouletteHistoryService {
  constructor(
    @InjectRepository(RouletteRound)
    private rouletteRoundRepository: Repository<RouletteRound>,
  ) {}

  async getRecentRounds(bookmakerId?: number, limit: number = 500): Promise<RouletteHistoryItem[]> {
    try {
      const queryBuilder = this.rouletteRoundRepository
        .createQueryBuilder('r')
        .leftJoinAndSelect('r.bookmaker', 'bookmaker')
                 .select([
           'r.id',
           'r.bookmakerId',
           'r.roundId',
           'r.number',
           'r.color',
           'r.timestamp',
           'bookmaker.bookmaker'
         ])
        .orderBy('r.id', 'DESC')
        .limit(limit);

      if (bookmakerId) {
        queryBuilder.where('r.bookmakerId = :bookmakerId', { bookmakerId });
      }

      const rounds = await queryBuilder.getMany();

             return rounds.map(round => ({
         id: round.id,
         bookmakerId: round.bookmakerId,
         roundId: round.roundId,
         number: round.number,
         color: round.color,
         timestamp: round.timestamp.toISOString(),
         bookmakerName: round.bookmaker?.bookmaker || 'Unknown'
       }));
    } catch (error) {
      console.error('Error fetching roulette history:', error);
      return [];
    }
  }
}
