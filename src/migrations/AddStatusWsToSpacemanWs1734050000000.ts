import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStatusWsToSpacemanWs1734050000000 implements MigrationInterface {
  name = 'AddStatusWsToSpacemanWs1734050000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Agregar columna status_ws a la tabla spaceman_ws
    await queryRunner.query(`
      ALTER TABLE "spaceman_ws"
      ADD COLUMN "status_ws" VARCHAR(20) NOT NULL DEFAULT 'DISCONNECTED'
    `);

    // Crear índice para mejorar consultas por estado
    await queryRunner.query(`
      CREATE INDEX "IDX_spaceman_ws_status_ws" ON "spaceman_ws" ("status_ws")
    `);

    // Actualizar registros existentes con estado por defecto
    await queryRunner.query(`
      UPDATE "spaceman_ws"
      SET "status_ws" = 'DISCONNECTED'
      WHERE "status_ws" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Eliminar índice
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_spaceman_ws_status_ws" ON "spaceman_ws"
    `);

    // Eliminar columna status_ws
    await queryRunner.query(`
      ALTER TABLE "spaceman_ws" DROP COLUMN IF EXISTS "status_ws"
    `);
  }
}
