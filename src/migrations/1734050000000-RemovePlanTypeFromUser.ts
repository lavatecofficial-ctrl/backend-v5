import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemovePlanTypeFromUser1734050000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Verificar si la columna existe antes de intentar eliminarla
    const table = await queryRunner.getTable('users');
    const planTypeColumn = table?.findColumnByName('planType');
    
    if (planTypeColumn) {
      await queryRunner.dropColumn('users', 'planType');
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // En caso de hacer rollback, volvemos a agregar la columna
    await queryRunner.query(`
      ALTER TABLE "users" 
      ADD COLUMN "planType" character varying NOT NULL DEFAULT 'free',
      ADD CONSTRAINT "CHK_planType_enum" CHECK ("planType" IN ('free', 'basic', 'premium', 'enterprise'))
    `);
  }
}
