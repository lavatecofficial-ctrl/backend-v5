import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStatusWsToAviatorWs1734040000000 implements MigrationInterface {
  name = 'AddStatusWsToAviatorWs1734040000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Agregar columna status_ws a la tabla aviator_ws
    await queryRunner.query(`
      ALTER TABLE "aviator_ws" 
      ADD COLUMN "status_ws" VARCHAR(20) NOT NULL DEFAULT 'DISCONNECTED'
    `);

    // Crear índice para mejorar consultas por estado
    await queryRunner.query(`
      CREATE INDEX "IDX_aviator_ws_status_ws" ON "aviator_ws" ("status_ws")
    `);

    // Actualizar registros existentes con estado por defecto
    await queryRunner.query(`
      UPDATE "aviator_ws" 
      SET "status_ws" = 'DISCONNECTED' 
      WHERE "status_ws" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Eliminar índice
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_aviator_ws_status_ws"
    `);

    // Eliminar columna status_ws
    await queryRunner.query(`
      ALTER TABLE "aviator_ws" DROP COLUMN IF EXISTS "status_ws"
    `);
  }
}
