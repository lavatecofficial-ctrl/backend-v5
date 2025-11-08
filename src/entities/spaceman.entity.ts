import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany, ManyToOne, JoinColumn } from 'typeorm';
import { SpacemanRound } from './spaceman-round.entity';
import { Game } from './game.entity';
import { Bookmaker } from './bookmaker.entity';

@Entity('spaceman_ws')
export class Spaceman {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'game_id' })
  gameId: number;

  @Column({ name: 'bookmaker_id' })
  bookmakerId: number;

  @Column({ name: 'url_sessionid', nullable: true })
  urlSessionid?: string;

  @Column({ nullable: true })
  jsessionid?: string;

  @Column({ name: 'broadcaster_base', nullable: true })
  broadcasterBase?: string;

  @Column({ name: 'finance_base', nullable: true })
  financeBase?: string;

  @Column({ name: 'token_updated_at', nullable: true })
  tokenUpdatedAt?: Date;

  @Column({ name: 'status_ws', type: 'varchar', length: 20, default: 'DISCONNECTED' })
  statusWs: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @ManyToOne(() => Game, game => game.id)
  @JoinColumn({ name: 'game_id' })
  game: Game;

  @ManyToOne(() => Bookmaker, bookmaker => bookmaker.id)
  @JoinColumn({ name: 'bookmaker_id' })
  bookmaker: Bookmaker;

  @OneToMany(() => SpacemanRound, round => round.spaceman)
  rounds: SpacemanRound[];
}
