import { MigrationInterface, QueryRunner } from 'typeorm';

export class RecreateSpacemanTable1734000000000 implements MigrationInterface {
  name = 'RecreateSpacemanTable1734000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Eliminar tablas relacionadas primero
    await queryRunner.query(`DROP TABLE IF EXISTS "spaceman_rounds" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "spaceman_ws" CASCADE`);
    
    // Crear nueva tabla con la estructura solicitada
    await queryRunner.query(`
      CREATE TABLE "spaceman_ws" (
        "id" SERIAL NOT NULL,
        "game_id" integer NOT NULL,
        "bookmaker_id" integer NOT NULL,
        "jsessionid" character varying,
        "broadcaster_base" character varying,
        "finance_base" character varying,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_spaceman_ws" PRIMARY KEY ("id"),
        CONSTRAINT "FK_spaceman_ws_game" FOREIGN KEY ("game_id") REFERENCES "games_list"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT "FK_spaceman_ws_bookmaker" FOREIGN KEY ("bookmaker_id") REFERENCES "bookmakers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
      )
    `);

    // Crear índices
    await queryRunner.query(`CREATE INDEX "IDX_spaceman_ws_game_id" ON "spaceman_ws" ("game_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_spaceman_ws_bookmaker_id" ON "spaceman_ws" ("bookmaker_id")`);

    // Recrear tabla spaceman_rounds
    await queryRunner.query(`
      CREATE TABLE "spaceman_rounds" (
        "id" SERIAL NOT NULL,
        "game_id" character varying NOT NULL,
        "bets_count" integer,
        "total_bet_amount" numeric(10,2),
        "online_player" integer,
        "max_multiplier" numeric(5,2),
        "total_cashout" numeric(10,2),
        "casino_profit" numeric(10,2),
        "spaceman_id" integer NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_spaceman_rounds" PRIMARY KEY ("id"),
        CONSTRAINT "FK_spaceman_rounds_spaceman" FOREIGN KEY ("spaceman_id") REFERENCES "spaceman_ws"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
      )
    `);

    // Crear índice para spaceman_rounds
    await queryRunner.query(`CREATE INDEX "IDX_spaceman_rounds_spaceman_id" ON "spaceman_rounds" ("spaceman_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Eliminar las tablas
    await queryRunner.query(`DROP TABLE IF EXISTS "spaceman_rounds" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "spaceman_ws" CASCADE`);
  }
}
