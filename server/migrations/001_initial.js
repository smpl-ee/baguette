export async function up(knex) {
  await knex.schema.createTable('users', (t) => {
    t.increments('id').primary();
    t.integer('github_id').unique().notNullable();
    t.string('username').notNullable();
    t.string('avatar_url');
    t.text('access_token').notNullable();
    t.boolean('approved').defaultTo(false);
    t.string('model').nullable();
    t.string('default_permission_mode').nullable();
    t.text('anthropic_api_key_encrypted').nullable();
    t.text('github_token_encrypted').nullable();
    t.text('allowed_commands').nullable();
    t.string('email').nullable();
    t.boolean('builder_modal_mode').defaultTo(true).notNullable();
    t.boolean('reviewer_modal_mode').defaultTo(false).notNullable();
    t.string('branch_prefix').notNullable().defaultTo('baguette/');
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('repos', (t) => {
    t.increments('id').primary();
    t.string('full_name').unique().notNullable();
    t.string('bare_path').notNullable();
    t.string('stripped_name').unique();
    t.string('default_branch').nullable();
    t.timestamp('last_fetched_at');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('deleted_at').nullable();
  });

  await knex.schema.createTable('sessions', (t) => {
    t.increments('id').primary();
    t.integer('user_id').references('id').inTable('users').notNullable();
    t.integer('repo_id').references('id').inTable('repos');
    t.string('repo_full_name').notNullable();
    t.string('base_branch').notNullable();
    t.string('created_branch');
    t.string('remote_branch');
    t.string('worktree_path');
    t.text('initial_prompt').notNullable();
    t.string('claude_session_id');
    t.string('permission_mode');
    t.boolean('plan_mode').defaultTo(false);
    t.string('status').defaultTo('running');
    t.string('model');
    t.string('label');
    t.string('short_id').unique();
    t.string('pr_url');
    t.integer('pr_number');
    t.string('pr_status').nullable(); // 'open' | 'draft' | 'closed' | 'merged'
    t.decimal('total_cost_usd', 12, 6).nullable();
    t.string('agent_type').notNullable().defaultTo('builder');
    t.boolean('initialized').notNullable().defaultTo(false);
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());
    t.timestamp('archived_at').nullable();
  });

  await knex.schema.createTable('session_messages', (t) => {
    t.increments('id').primary();
    t.integer('session_id').references('id').inTable('sessions').notNullable();
    t.string('type').notNullable();
    t.string('subtype');
    t.string('uuid');
    t.text('message_json').notNullable();
    t.decimal('total_cost_usd', 12, 6);
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('secrets', (t) => {
    t.increments('id').primary();
    t.string('key').unique().notNullable();
    t.text('value').notNullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('usage', (t) => {
    t.increments('id').primary();
    t.integer('session_id').references('id').inTable('sessions').notNullable();
    t.integer('user_id').references('id').inTable('users').notNullable();
    t.string('repo_full_name').notNullable();
    t.decimal('cost_usd', 12, 6).notNullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('user_repos', (t) => {
    t.increments('id').primary();
    t.integer('user_id').references('id').inTable('users').notNullable();
    t.integer('repo_id').references('id').inTable('repos').notNullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.unique(['user_id', 'repo_id']);
  });

  await knex('sessions')
    .whereNotNull('pr_number')
    .whereNull('pr_status')
    .update({ pr_status: 'open' });
}

export function down(knex) {
  return knex.schema
    .dropTableIfExists('user_repos')
    .dropTableIfExists('usage')
    .dropTableIfExists('secrets')
    .dropTableIfExists('session_messages')
    .dropTableIfExists('sessions')
    .dropTableIfExists('repos')
    .dropTableIfExists('users');
}
