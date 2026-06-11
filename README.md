# FACOFFEE - Users Service

# Alunos:
* Lucas Renato Corrêa
* Natan Alves 
* Gabriel Henrique Ribeiro da Silva
* Vitor Brambila

Este repositório contém a implementação do **microsserviço de Usuários (Users Service)** da solução **FACOFFEE**.


## 1. Objetivo do serviço

O serviço de usuários gerencia o ciclo de vida dos usuários na plataforma FACOFFEE. Ele segue:

* isolamento de domínio, com banco de dados próprio;
* contratos definidos no OpenAPI da disciplina;
* autenticação e autorização integradas ao Keycloak;
* comunicação assíncrona orientada a eventos com RabbitMQ.

### Escopo funcional

* criar usuário no domínio e no Keycloak;
* listar usuários com filtros e paginação;
* buscar usuário por identificador;
* atualizar dados básicos do usuário;
* desativar usuário logicamente;
* substituir papéis do usuário em rota dedicada.

## 2. Pré-requisitos

Para executar o serviço localmente, você precisará de:

* Node.js 20+;
* npm;
* infraestrutura base do FACOFFEE em execução para integração completa:

  * API Gateway;
  * Keycloak;
  * RabbitMQ.

## 3. Preparação inicial

Na raiz do projeto, instale as dependências:

```bash
npm install
```

Crie um arquivo `.env` na raiz do projeto com o conteúdo abaixo:

```env
DATABASE_URL="file:./dev.db"
```

Em seguida, gere o cliente Prisma e crie as tabelas do banco de dados:

```bash
npx prisma generate
npx prisma migrate dev --name init
```

## 4. Subindo o ambiente

Para iniciar o serviço em modo de desenvolvimento:

```bash
npm run dev
```

O serviço será iniciado na porta `3001`.

Para testes completos, a infraestrutura base do FACOFFEE deve estar em execução na pasta principal do projeto:

```bash
docker compose up -d
```

## 5. Interfaces disponíveis

As rotas podem ser acessadas diretamente ou via gateway. O serviço expõe tanto `/users` quanto `/api/users` para compatibilidade com o ambiente do projeto.

```text
http://localhost:3001/users
http://localhost:8000/api/users
```

| Método | Endpoint | Descrição |
| ------ | -------- | --------- |
| GET | `/users/health` | Health check do serviço |
| POST | `/users` | Cadastro de usuário |
| GET | `/users` | Lista usuários com paginação |
| GET | `/users/:userId` | Busca usuário por ID |
| PATCH | `/users/:userId` | Atualiza dados básicos |
| PUT | `/users/:userId/roles` | Substitui papéis do usuário |
| DELETE | `/users/:userId` | Desativa usuário logicamente |

### Autenticação

As rotas abaixo exigem JWT válido no cabeçalho:

```http
Authorization: Bearer <token>
```

Rotas protegidas:

* `GET /users`
* `GET /users/:userId`
* `PATCH /users/:userId`
* `PUT /users/:userId/roles`
* `DELETE /users/:userId`

Regras principais:

* `GET /users` exige role `MANAGER`;
* `GET /users/:userId`, `PATCH /users/:userId` e `DELETE /users/:userId` aceitam `MANAGER` ou o próprio usuário;
* `PUT /users/:userId/roles` é restrita a `MANAGER`.

## 6. Integrações de plataforma

### Keycloak

Durante o cadastro (`POST /users`), o serviço:

1. obtém um token administrativo com o cliente confidencial `facoffee-private` usando `client_credentials`;
2. cria o usuário no realm `facoffee`;
3. define a senha temporária padrão `mudar123`.

### RabbitMQ

O serviço publica eventos com uma conexão reutilizada, evitando abrir e fechar uma conexão a cada mensagem.

Filas usadas:

| Fila | Descrição |
| ---- | --------- |
| `users.created` | Usuário criado |
| `users.deactivated` | Usuário desativado |

### Persistência

O banco do serviço é exclusivo e usa Prisma com SQLite local. O modelo do usuário contém, no mínimo:

* `id`
* `name`
* `email`
* `status`
* `roles`
* `createdAt`
* `updatedAt`
* `deactivatedAt`

## 7. Testes automatizados e evidências

Os testes automatizados foram desenvolvidos com Jest e Supertest.

Para executar a suíte de testes:

```bash
npm test -- --runInBand
```

A suíte cobre:

* healthcheck;
* criação de usuário com role padrão;
* conflito de e-mail;
* validação de JWT;
* autorização por role;
* paginação de listagem;
* atualização básica;
* substituição de roles;
* desativação lógica com evento.

Os testes estão localizados em:

```text
src/__tests__
```

## 8. Padrões de desenvolvimento adotados

Os padrões abaixo foram os escolhidos para a apresentação do grupo e estão descritos de acordo com o que o código do Users Service já expressa hoje.

### 8.1 Decomposition by Subdomain

O Users Service representa um subdomínio próprio da solução FACOFFEE. Isso aparece no código pelo isolamento do serviço, pelo modelo de dados exclusivo e pelas responsabilidades concentradas em cadastro, busca, atualização, desativação e papéis de usuários.

Na prática, o serviço é o bounded context responsável por:

* criar usuários;
* listar usuários;
* atualizar dados básicos;
* desativar usuários;
* substituir roles;
* sincronizar identidade com o Keycloak.

### 8.2 Synchronous Communication (REST)

A comunicação principal do serviço é síncrona via HTTP REST. Todas as operações do domínio são expostas por rotas Express e seguem o contrato do OpenAPI.

Exemplos no código:

* `GET /users`
* `GET /users/:userId`
* `PATCH /users/:userId`
* `PUT /users/:userId/roles`
* `DELETE /users/:userId`

### 8.3 Health Check

O serviço disponibiliza um endpoint de saúde para validação operacional.

Exemplo no código:

* `GET /users/health`

Esse endpoint responde com um payload simples e serve para indicar que o serviço está ativo.

### 8.4 Canary Release

Canary Release é um padrão de implantação gradual, não uma regra de negócio do serviço. Portanto, ele não aparece como lógica interna do Users Service, mas como estratégia de deploy na infraestrutura do projeto.

Para este trabalho, o padrão deve ser apresentado assim:

* uma nova versão é liberada primeiro para uma fatia pequena de usuários ou tráfego;
* se não houver erros, a liberação é ampliada progressivamente;
* caso apareçam falhas, a exposição da versão nova é reduzida ou revertida.

No contexto do FACOFFEE, isso é explicado no nível do gateway/infraestrutura, não dentro do código do domínio Users.

## 9. Referências importantes

### Documentação

* `GUIA_EQUIPE_USERS.md`
* `api-docs.yaml`
* `async-docs.yaml`

### Tecnologias utilizadas

* Node.js
* Express
* Prisma ORM
* SQLite
* RabbitMQ
* Keycloak Admin API
* Jest
* Supertest
* Docker, para a infraestrutura base do projeto
