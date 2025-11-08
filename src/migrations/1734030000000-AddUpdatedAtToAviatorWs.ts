import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUpdatedAtToAviatorWs1734030000000 implements MigrationInterface {
  name = 'AddUpdatedAtToAviatorWs1734030000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Agregar columna updated_at a la tabla aviator_ws
    await queryRunner.query(`
      ALTER TABLE "aviator_ws" 
      ADD COLUMN "updated_at" TIMESTAMP NOT NULL DEFAULT now()
    `);

    // Crear trigger para actualizar updated_at automáticamente
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ language 'plpgsql';
    `);

    // Crear trigger en la tabla aviator_ws
    await queryRunner.query(`
      CREATE TRIGGER update_aviator_ws_updated_at 
      BEFORE UPDATE ON "aviator_ws" 
      FOR EACH ROW 
      EXECUTE FUNCTION update_updated_at_column();
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Eliminar trigger
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS update_aviator_ws_updated_at ON "aviator_ws"
    `);

    // Eliminar función
    await queryRunner.query(`
      DROP FUNCTION IF EXISTS update_updated_at_column()
    `);

    // Eliminar columna updated_at
    await queryRunner.query(`
      ALTER TABLE "aviator_ws" DROP COLUMN IF EXISTS "updated_at"
    `);
  }
}
