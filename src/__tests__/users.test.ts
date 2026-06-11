import request from 'supertest';

let prismaMock: {
  user: {
    findUnique: jest.Mock;
    findMany: jest.Mock;
    count: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
};

jest.mock('@prisma/client', () => {
  prismaMock = {
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn()
    }
  };

  return {
    PrismaClient: jest.fn(() => prismaMock)
  };
});

jest.mock('../keycloak', () => ({
  createKeycloakUser: jest.fn().mockResolvedValue(true)
}));

jest.mock('../rabbitmq', () => ({
  sendToQueue: jest.fn().mockResolvedValue(true)
}));

import app from '../server';
import { createKeycloakUser } from '../keycloak';
import { sendToQueue } from '../rabbitmq';

const mockedCreateKeycloakUser = createKeycloakUser as jest.Mock;
const mockedSendToQueue = sendToQueue as jest.Mock;

function mockUserInfo(profile: Record<string, unknown>) {
  (globalThis as typeof globalThis & { fetch: jest.Mock }).fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => profile
  });
}

function baseUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'usr_1',
    name: 'Maria Silva',
    email: 'maria.silva@departamento.edu.br',
    status: 'ACTIVE',
    roles: 'PARTICIPANT',
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    deactivatedAt: null,
    ...overrides
  };
}

describe('Users Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.CANARY_ENABLED;
    delete process.env.CANARY_PERCENTAGE;
    delete process.env.CANARY_SEED;
    prismaMock.user.findUnique.mockReset();
    prismaMock.user.findMany.mockReset();
    prismaMock.user.count.mockReset();
    prismaMock.user.create.mockReset();
    prismaMock.user.update.mockReset();
    prismaMock.user.delete.mockReset();
  });

  it('expõe healthcheck nas rotas nova e legada', async () => {
    const root = await request(app).get('/');
    const modern = await request(app).get('/users/health');
    const legacy = await request(app).get('/api/users/health');

    expect(root.status).toBe(200);
    expect(root.headers['content-type']).toContain('text/html');
    expect(root.text).toContain('FACOFFEE Users Service');
    expect(modern.status).toBe(200);
    expect(modern.headers['content-type']).toContain('text/html');
    expect(modern.text).toContain('Users Health');
    expect(modern.text).toContain('Status: ok');
    expect(legacy.status).toBe(200);
    expect(legacy.headers['content-type']).toContain('text/html');
    expect(legacy.text).toContain('Users Health');
  });

  it('expõe decisão de canary quando a liberação gradual está habilitada', async () => {
    process.env.CANARY_ENABLED = 'true';
    process.env.CANARY_PERCENTAGE = '100';
    process.env.CANARY_SEED = 'tests';

    const response = await request(app)
      .get('/users/health')
      .set('X-Canary-Key', 'group-5');

    expect(response.status).toBe(200);
    expect(response.headers['x-canary-enabled']).toBe('true');
    expect(response.headers['x-canary-variant']).toBe('canary');
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.text).toContain('Release: canary');
  });

  it('cria usuário com role padrão e integra Keycloak/RabbitMQ', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    prismaMock.user.create.mockResolvedValueOnce(baseUser());

    const response = await request(app)
      .post('/users')
      .send({ name: 'Maria Silva', email: 'maria.silva@departamento.edu.br' });

    expect(response.status).toBe(201);
    expect(response.body.roles).toEqual(['PARTICIPANT']);
    expect(mockedCreateKeycloakUser).toHaveBeenCalledWith('Maria Silva', 'maria.silva@departamento.edu.br');
    expect(mockedSendToQueue).toHaveBeenCalledWith('users.created', expect.objectContaining({
      eventType: 'UserCreated',
      payload: expect.objectContaining({
        email: 'maria.silva@departamento.edu.br',
        roles: ['PARTICIPANT']
      })
    }));
  });

  it('retorna 409 quando o email já existe', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(baseUser());

    const response = await request(app)
      .post('/users')
      .send({ name: 'Maria Silva', email: 'maria.silva@departamento.edu.br' });

    expect(response.status).toBe(409);
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it('rejeita listagem sem token', async () => {
    const response = await request(app).get('/users');
    expect(response.status).toBe(401);
  });

  it('bloqueia listagem para PARTICIPANT', async () => {
    mockUserInfo({ email: 'participante@ufms.br', roles: ['PARTICIPANT'] });

    const response = await request(app)
      .get('/users')
      .set('Authorization', 'Bearer participant-token');

    expect(response.status).toBe(403);
  });

  it('lista usuários com paginação para MANAGER', async () => {
    mockUserInfo({ email: 'gestor@ufms.br', roles: ['MANAGER'] });
    prismaMock.user.findMany.mockResolvedValueOnce([baseUser()]);
    prismaMock.user.count.mockResolvedValueOnce(1);

    const response = await request(app)
      .get('/users?page=1&size=10')
      .set('Authorization', 'Bearer manager-token');

    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.total).toBe(1);
  });

  it('permite atualização do próprio usuário pela rota PATCH', async () => {
    mockUserInfo({ email: 'maria.silva@departamento.edu.br', roles: ['PARTICIPANT'] });
    prismaMock.user.findUnique.mockResolvedValueOnce(baseUser());
    prismaMock.user.update.mockResolvedValueOnce(baseUser({ name: 'Maria Souza' }));

    const response = await request(app)
      .patch('/users/usr_1')
      .set('Authorization', 'Bearer self-token')
      .send({ name: 'Maria Souza' });

    expect(response.status).toBe(200);
    expect(response.body.name).toBe('Maria Souza');
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'usr_1' },
      data: { name: 'Maria Souza' }
    });
  });

  it('substitui papéis pela rota dedicada', async () => {
    mockUserInfo({ email: 'gestor@ufms.br', roles: ['MANAGER'] });
    prismaMock.user.findUnique.mockResolvedValueOnce(baseUser());
    prismaMock.user.update.mockResolvedValueOnce(baseUser({ roles: 'MANAGER' }));

    const response = await request(app)
      .put('/users/usr_1/roles')
      .set('Authorization', 'Bearer manager-token')
      .send({ roles: ['MANAGER'] });

    expect(response.status).toBe(200);
    expect(response.body.roles).toEqual(['MANAGER']);
  });

  it('desativa o próprio usuário e publica evento de desativação', async () => {
    mockUserInfo({ email: 'maria.silva@departamento.edu.br', roles: ['PARTICIPANT'] });
    prismaMock.user.findUnique.mockResolvedValueOnce(baseUser());
    prismaMock.user.update.mockResolvedValueOnce(baseUser({
      status: 'INACTIVE',
      deactivatedAt: new Date('2026-06-01T00:00:01.000Z')
    }));

    const response = await request(app)
      .delete('/users/usr_1')
      .set('Authorization', 'Bearer self-token')
      .send({ reason: 'Encerramento do vínculo' });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('INACTIVE');
    expect(mockedSendToQueue).toHaveBeenCalledWith('users.deactivated', expect.objectContaining({
      eventType: 'UserDeactivated',
      payload: expect.objectContaining({ userId: 'usr_1', reason: 'Encerramento do vínculo' })
    }));
  });
});