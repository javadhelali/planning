• Snapshot: 2026-04-15

  | Git repo | GitHub remote | Local changes | Ahead/Behind | GitHub backup now |
  |---|---:|---:|---:|---|
  | app-gen-apps/app_3u6a8 | No | 3 | 0/0 | No |
  | app-gen-apps/app_7c88o | No | 4 | 0/0 | No |
  | app-gen-apps/app_h7n8c | No | 3 | 0/0 | No |
  | app-gen-apps/template | No | 1 | 0/0 | No |
  | app-gen | No | 26 | 0/0 | No |
  | app-maker | Yes | 6 | 0/0 | Partial |
  | app-maker/app-maker-agent | Yes | 0 | 0/0 | Yes |
  | app-maker/app-maker-api | Yes | 0 | 0/0 | Yes |
  | app-maker/app-maker-template | No | 2 | 0/0 | No |
  | app-maker/app-maker-ui | Yes | 4 | 0/0 | Partial |
  | library | Yes | 0 | 0/0 | Yes |
  | market | No | 5 | 0/0 | No |
  | market/market-api | Yes | 0 | 0/0 | Yes |
  | market/market-data | No | 8 | 0/0 | No |
  | market/market-old | Yes | 0 | 0/0 | Yes |
  | market/market-ui | No | 12 | 0/0 | No |
  | marketplace | No | 10 | 0/0 | No |
  | planning | Yes | 0 | 0/0 | Yes |
  | shop-tools | No | 35 | 0/0 | No |
  | trading | Yes | 49 | 8/1 | Partial |

  | Non-Git folder | Nested Git repos | Files in folder | Total files | Server-loss risk |
  |---|---:|---:|---:|---|
  | /app/code/app-gen-apps | 4 | 1 | 22012 | Yes (root folder not a repo) |
  | /app/code/internet | 0 | 7 | 15 | Yes |
  | /app/code/libir | 0 | 3 | 3 | Yes |
  | /app/code/server | 0 | 2 | 2 | Yes |

  | Project | DB service | Engine | Persistent data path | Daily/Weekly backup |
  |---|---|---|---|---|
  | app-gen | appgen-db | Postgres | /app/docker/appgen-postgres | No evidence |
  | app-gen | appgen-apps-db | Postgres | /app/docker/appgen-apps-postgres | No evidence |
  | library | library-postgres | Postgres | /app/docker/library-postgres | No evidence |
  | market | market-postgres | Postgres | /app/docker/market-postgres | Yes (@daily, weekly kept) |
  | market | market-metabase | SQLite (Metabase file DB) | /app/docker/market-metabase | No evidence |
  | marketplace | marketplace-postgres | Postgres | /app/docker/marketplace-postgres | Yes (@daily, weekly kept) |
  | planning | planning-db | Postgres | /app/docker/planning-postgres | No evidence |
  | shop-tools | postgres | Postgres | /app/docker/shoptools/postgres | No evidence |
  | shop-tools | redis | Redis | /app/docker/shoptools/redis | No evidence |
  | trading | trading-postgres-historical | Postgres | /app/docker/trading-postgres-historical/data | Yes (@daily, weekly kept) |
  | trading | trading-postgres | Postgres | /app/docker/trading-postgres/data | Yes (@daily, weekly kept) |
  | trading | trading-redis | Redis | /app/docker/trading-redis/data | No evidence |

  | Persistent data (should be backed up) | Current daily/weekly backup evidence |
  |---|---|
  | /app/docker/appgen-postgres | No |
  | /app/docker/appgen-apps-postgres | No |
  | /app/docker/library-postgres | No |
  | /app/docker/planning-postgres | No |
  | /app/docker/shoptools/postgres | No |
  | /app/docker/shoptools/redis | No |
  | /app/docker/trading-redis/data | No |
  | /app/docker/market-metabase | No |
  | /app/data/library | No |
  | /app/data/market | No |
  | /app/docker/nginx-proxy-manager/data | No |
  | /app/docker/nginx-proxy-manager/letsencrypt | No |
  | /app/docker/portainer | No |
  | /app/code/internet/data/gluetun | No |
  | /app/code/internet/vpn | No |