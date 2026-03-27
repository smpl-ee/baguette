export async function up(knex) {
  await knex.schema.alterTable('sessions', (t) => {
    t.boolean('create_new_branch').notNullable().defaultTo(1);
    t.boolean('auto_create_pr').notNullable().defaultTo(1);
    t.boolean('auto_push').notNullable().defaultTo(1);
  });
}

export async function down(knex) {
  await knex.raw('ALTER TABLE sessions DROP COLUMN create_new_branch');
  await knex.raw('ALTER TABLE sessions DROP COLUMN auto_create_pr');
  await knex.raw('ALTER TABLE sessions DROP COLUMN auto_push');
}
