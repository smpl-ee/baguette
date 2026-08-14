export async function up(knex) {
  await knex.raw("ALTER TABLE usage ADD COLUMN agent_sdk VARCHAR(20) NOT NULL DEFAULT 'claude'");
}

export async function down(knex) {
  await knex.raw('ALTER TABLE usage DROP COLUMN agent_sdk');
}
