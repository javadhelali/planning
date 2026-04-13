create table if not exists users (
  id bigserial primary key,
  username text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists users_username_idx on users (username);

create table if not exists tasks (
  id bigserial primary key,
  user_id bigint not null references users (id) on delete cascade,
  title text not null,
  notes text,
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'done')),
  due_date date,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tasks_user_id_idx on tasks (user_id);
create index if not exists tasks_status_idx on tasks (status);
create index if not exists tasks_due_date_idx on tasks (due_date);
