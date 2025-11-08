import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Bookmaker } from './bookmaker.entity';
import { Game } from './game.entity';

@Entity('roulette_ws')
export class RouletteWs {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'bookmaker_id' })
  bookmakerId: number;

  @Column({ name: 'game_id' })
  gameId: number;

  @Column()
  page: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => Bookmaker)
  @JoinColumn({ name: 'bookmaker_id' })
  bookmaker: Bookmaker;

  @ManyToOne(() => Game)
  @JoinColumn({ name: 'game_id' })
  game: Game;
}
