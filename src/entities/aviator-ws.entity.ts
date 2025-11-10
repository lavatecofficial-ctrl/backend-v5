import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Bookmaker } from './bookmaker.entity';
import { Game } from './game.entity';

@Entity('aviator_ws')
export class AviatorWs {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'bookmaker_id' })
  bookmakerId: number;

  @Column({ name: 'game_id' })
  gameId: number;

  @Column({ type: 'varchar', length: 500 })
  url_websocket: string;

  @Column({ type: 'text', nullable: true })
  api_message: string;

  @Column({ type: 'text', nullable: true })
  auth_message: string;

  @Column({ type: 'text', nullable: true })
  ping_message: string;

  @Column({ type: 'jsonb', nullable: true })
  headers: any;

  @Column({ name: 'status_ws', type: 'varchar', length: 20, default: 'DISCONNECTED' })
  status_ws: string;

  @Column({ name: 'is_editable', type: 'boolean', default: true })
  is_editable: boolean;

  @CreateDateColumn()
  created_at: Date;

  @Column({ name: 'updated_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' })
  updated_at: Date;

  @ManyToOne(() => Bookmaker, bookmaker => bookmaker.id)
  @JoinColumn({ name: 'bookmaker_id' })
  bookmaker: Bookmaker;

  @ManyToOne(() => Game, game => game.id)
  @JoinColumn({ name: 'game_id' })
  game: Game;
}
