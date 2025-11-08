import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class CreateSpacemanTables1733928000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Crear tabla spaceman_ws
    await queryRunner.createTable(
      new Table({
        name: 'spaceman_ws',
        columns: [
          {
            name: 'id',
            type: 'serial',
            isPrimary: true,
          },
          {
            name: 'game_id',
            type: 'integer',
            isNullable: false,
          },
          {
            name: 'bookmaker_id',
            type: 'integer',
            isNullable: false,
          },
          {
            name: 'url_websocket',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'finance_websocket',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
        foreignKeys: [
          {
            columnNames: ['game_id'],
            referencedTableName: 'games_list',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
          {
            columnNames: ['bookmaker_id'],
            referencedTableName: 'bookmakers',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
      }),
      true
    );

    // Crear tabla spaceman_rounds
    await queryRunner.createTable(
      new Table({
        name: 'spaceman_rounds',
        columns: [
          {
            name: 'id',
            type: 'serial',
            isPrimary: true,
          },
          {
            name: 'game_id',
            type: 'varchar',
            length: '255',
            isNullable: false,
            isUnique: true,
          },
          {
            name: 'bets_count',
            type: 'integer',
            isNullable: true,
          },
          {
            name: 'total_bet_amount',
            type: 'double precision',
            isNullable: true,
          },
          {
            name: 'online_player',
            type: 'integer',
            isNullable: true,
          },
          {
            name: 'max_multiplier',
            type: 'double precision',
            isNullable: true,
          },
          {
            name: 'total_cashout',
            type: 'double precision',
            isNullable: true,
          },
          {
            name: 'casino_profit',
            type: 'double precision',
            isNullable: true,
          },
          {
            name: 'spaceman_id',
            type: 'integer',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
        foreignKeys: [
          {
            columnNames: ['spaceman_id'],
            referencedTableName: 'spaceman_ws',
            referencedColumnNames: ['id'],
            onDelete: 'SET NULL',
          },
        ],
      }),
      true
    );

    // Crear índices usando SQL directo
    await queryRunner.query(`
      CREATE UNIQUE INDEX "idx_spaceman_rounds_game_id" ON "spaceman_rounds" ("game_id");
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_spaceman_rounds_spaceman_id" ON "spaceman_rounds" ("spaceman_id");
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_spaceman_rounds_created_at" ON "spaceman_rounds" ("created_at");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Eliminar índices usando SQL directo
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_spaceman_rounds_created_at";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_spaceman_rounds_spaceman_id";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_spaceman_rounds_game_id";`);

    // Eliminar tablas
    await queryRunner.dropTable('spaceman_rounds');
    await queryRunner.dropTable('spaceman_ws');
  }
}
