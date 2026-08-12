export async function up(knex) {
  await knex.schema.table('sessions', (t) => {
    t.string('agent_sdk').notNullable().defaultTo('claude');
    t.string('cursor_agent_id').nullable();
  });

  await knex.schema.table('users', (t) => {
    t.text('cursor_api_key_encrypted').nullable();
  });
}

export async function down(knex) {
  await knex.raw('ALTER TABLE sessions DROP COLUMN agent_sdk');
  await knex.raw('ALTER TABLE sessions DROP COLUMN cursor_agent_id');
  await knex.raw('ALTER TABLE users DROP COLUMN cursor_api_key_encrypted');
}
