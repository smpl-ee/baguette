export async function up(knex) {
  await knex.schema.alterTable('sessions', (t) => {
    t.text('pr_description').nullable();
  });
}

export async function down(knex) {
  await knex.raw('ALTER TABLE sessions DROP COLUMN pr_description');
}
