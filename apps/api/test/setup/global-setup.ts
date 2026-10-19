// Roda uma vez antes dos testes e2e: garante que o banco de testes existe e está migrado.
import { execSync } from 'node:child_process';
import pg from 'pg';
import { TEST_DATABASE_URL } from './test-database.js';

async function ensureDatabaseExists(url: URL): Promise<void> {
  const dbName = url.pathname.replace(/^\//, '');
  // Conecta no banco principal (mesmo usuário, que tem CREATEDB) para criar o de testes se faltar.
  const maintenanceUrl = new URL(url.toString());
  maintenanceUrl.pathname = '/helpdesk';
  maintenanceUrl.search = '';
  const client = new pg.Client({ connectionString: maintenanceUrl.toString() });
  await client.connect();
  try {
    const { rowCount } = await client.query('select 1 from pg_database where datname = $1', [
      dbName,
    ]);
    if (rowCount === 0) {
      await client.query(`create database "${dbName}"`);
    }
  } finally {
    await client.end();
  }
}

export default async function globalSetup(): Promise<void> {
  const url = new URL(TEST_DATABASE_URL);
  try {
    await ensureDatabaseExists(url);
  } catch (error) {
    throw new Error(
      `Não foi possível preparar o banco de testes em ${url.host}. A infra local está no ar? (pnpm infra:up)`,
      { cause: error },
    );
  }
  execSync('pnpm exec prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
}
