-- Executado uma única vez, quando o volume do PostgreSQL é criado (docker-entrypoint-initdb.d).
-- Para rodar de novo: `docker compose down -v` apaga o volume.

-- Aplicação. CREATEDB é necessário para o shadow database do `prisma migrate dev`.
CREATE ROLE helpdesk WITH LOGIN PASSWORD 'helpdesk' CREATEDB;
CREATE DATABASE helpdesk OWNER helpdesk;
-- Banco dos testes e2e da API (migrado pelo globalSetup do Vitest).
CREATE DATABASE helpdesk_test OWNER helpdesk;

-- Zitadel. Em dev, o Zitadel conecta com o superusuário (ver docker-compose.yml).
CREATE DATABASE zitadel;
