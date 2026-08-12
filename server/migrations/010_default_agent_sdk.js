export async function up(knex) {
  await knex.raw('ALTER TABLE users ADD COLUMN default_agent_sdk TEXT');
}

export async function down(knex) {
  await knex.raw('ALTER TABLE users DROP COLUMN default_agent_sdk');
}
