import crypto from 'crypto';
import express, { type Request, type Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { resolveCanaryDecision } from './canary';
import { authenticateRequest, canAccessUser, requireManager } from './auth';
import { createKeycloakUser } from './keycloak';
import { sendToQueue } from './rabbitmq';

type UserRecord = {
  id: string;
  name: string;
  email: string;
  status: string;
  roles: string;
  createdAt: Date;
  updatedAt: Date;
  deactivatedAt: Date | null;
};

const prisma = new PrismaClient();
const app = express();
const usersRouter = express.Router();

app.use(express.json());

app.get('/', (_req, res) => {
  return res
    .status(200)
    .type('html')
    .send(`
      <!doctype html>
      <html lang="pt-BR">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>FACOFFEE Users</title>
        </head>
        <body>
          <h1>FACOFFEE Users Service</h1>
          <p>Status: ok</p>
          <ul>
            <li><a href="/users/health">/users/health</a></li>
            <li><a href="/api/users/health">/api/users/health</a></li>
          </ul>
        </body>
      </html>
    `);
});

function splitRoles(roles: string): string[] {
  return roles
    .split(',')
    .map((role) => role.trim())
    .filter(Boolean);
}

function normalizeRolesInput(roles: unknown): string[] {
  if (Array.isArray(roles)) {
    return roles.map((role) => String(role).trim()).filter(Boolean);
  }

  if (typeof roles === 'string') {
    return roles.split(',').map((role) => role.trim()).filter(Boolean);
  }

  return [];
}

function serializeUser(user: UserRecord) {
  return {
    ...user,
    roles: splitRoles(user.roles)
  };
}

function buildPagination(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }

  return parsed;
}

async function loadUserOrNotFound(userId: string): Promise<UserRecord | null> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  return user as UserRecord | null;
}

async function sendCreatedEvent(user: UserRecord, roles: string[]): Promise<void> {
  await sendToQueue('users.created', {
    eventId: crypto.randomUUID(),
    eventType: 'UserCreated',
    occurredAt: new Date().toISOString(),
    version: '1.0',
    payload: {
      userId: user.id,
      name: user.name,
      email: user.email,
      roles,
      status: user.status
    }
  });
}

function applyCanaryHeaders(req: Request, res: Response) {
  const decision = resolveCanaryDecision(req);
  res.setHeader('X-Canary-Enabled', decision.enabled ? 'true' : 'false');
  res.setHeader('X-Canary-Variant', decision.variant);
  res.setHeader('X-Canary-Cohort', decision.cohortKey);
  res.setHeader('X-Canary-Percentage', String(decision.percentage));
  return decision;
}

usersRouter.get('/health', (req, res) => {
  const decision = applyCanaryHeaders(req, res);
  return res
    .status(200)
    .type('html')
    .send(`
      <!doctype html>
      <html lang="pt-BR">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>Health - FACOFFEE Users</title>
        </head>
        <body>
          <h1>Users Health</h1>
          <p>Status: ok</p>
          <p>Service: users</p>
          <p>Release: ${decision.variant}</p>
        </body>
      </html>
    `);
});

usersRouter.post('/', async (req, res): Promise<Response | void> => {
  try {
    applyCanaryHeaders(req, res);
    const { name, email, roles } = req.body ?? {};

    if (!name || !email) {
      return res.status(400).json({ error: 'Nome e email são obrigatórios.' });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(409).json({ error: 'Este e-mail já está em uso no sistema.' });
    }

    const roleList = normalizeRolesInput(roles);
    const userRoles = roleList.length > 0 ? roleList : ['PARTICIPANT'];

    const createdUser = await prisma.user.create({
      data: {
        name,
        email,
        status: 'ACTIVE',
        roles: userRoles.join(',')
      }
    });

    try {
      await createKeycloakUser(name, email);
    } catch (keycloakError) {
      await prisma.user.delete({ where: { id: createdUser.id } });
      throw keycloakError;
    }

    await sendCreatedEvent(createdUser as UserRecord, userRoles);

    return res.status(201).json(serializeUser(createdUser as UserRecord));
  } catch (error) {
    console.error('Erro ao criar usuário:', error);
    return res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

usersRouter.get('/', authenticateRequest, requireManager, async (req, res): Promise<Response | void> => {
  try {
    applyCanaryHeaders(req, res);
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const role = typeof req.query.role === 'string' ? req.query.role : undefined;
    const page = buildPagination(req.query.page, 1);
    const size = buildPagination(req.query.size, 10);
    const skip = (page - 1) * size;

    const where: Record<string, unknown> = {};

    if (status) {
      where.status = status;
    }

    if (role) {
      where.roles = { contains: role };
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: size
      }),
      prisma.user.count({ where })
    ]);

    return res.json({
      items: users.map((user) => serializeUser(user as UserRecord)),
      page,
      size,
      total
    });
  } catch (error) {
    console.error('Erro ao listar usuários:', error);
    return res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

usersRouter.get('/:userId', authenticateRequest, async (req, res): Promise<Response | void> => {
  try {
    applyCanaryHeaders(req, res);
    const { userId } = req.params;
    const user = await loadUserOrNotFound(userId);

    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado no banco de dados.' });
    }

    if (!canAccessUser(req, user.email)) {
      return res.status(403).json({ error: 'Acesso negado para este usuário.' });
    }

    return res.json(serializeUser(user));
  } catch (error) {
    console.error('Erro ao buscar usuário:', error);
    return res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

async function updateUserBasics(req: Request, res: Response): Promise<Response | void> {
  try {
    applyCanaryHeaders(req, res);
    const { userId } = req.params;
    const { name } = req.body ?? {};

    if (!name) {
      return res.status(400).json({ error: 'O nome do usuário é obrigatório.' });
    }

    const user = await loadUserOrNotFound(userId);

    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado no banco de dados.' });
    }

    if (!canAccessUser(req, user.email)) {
      return res.status(403).json({ error: 'Acesso negado para este usuário.' });
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { name }
    });

    return res.json(serializeUser(updatedUser as UserRecord));
  } catch (error) {
    console.error('Erro ao atualizar usuário:', error);
    return res.status(500).json({ error: 'Erro ao atualizar (verifique se o ID existe).' });
  }
}

usersRouter.patch('/:userId', authenticateRequest, updateUserBasics);
usersRouter.put('/:userId', authenticateRequest, updateUserBasics);

usersRouter.put('/:userId/roles', authenticateRequest, requireManager, async (req, res): Promise<Response | void> => {
  try {
    applyCanaryHeaders(req, res);
    const { userId } = req.params;
    const roleList = normalizeRolesInput(req.body?.roles);

    if (roleList.length === 0) {
      return res.status(400).json({ error: 'Informe ao menos um papel para substituir.' });
    }

    const user = await loadUserOrNotFound(userId);

    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado no banco de dados.' });
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { roles: roleList.join(',') }
    });

    return res.json(serializeUser(updatedUser as UserRecord));
  } catch (error) {
    console.error('Erro ao atualizar papéis do usuário:', error);
    return res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

usersRouter.delete('/:userId', authenticateRequest, async (req, res): Promise<Response | void> => {
  try {
    applyCanaryHeaders(req, res);
    const { userId } = req.params;
    const { reason } = req.body ?? {};
    const user = await loadUserOrNotFound(userId);

    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado no banco de dados.' });
    }

    if (!canAccessUser(req, user.email)) {
      return res.status(403).json({ error: 'Acesso negado para este usuário.' });
    }

    const deactivatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        status: 'INACTIVE',
        deactivatedAt: new Date()
      }
    });

    await sendToQueue('users.deactivated', {
      eventId: crypto.randomUUID(),
      eventType: 'UserDeactivated',
      occurredAt: new Date().toISOString(),
      version: '1.0',
      payload: {
        userId,
        reason: typeof reason === 'string' && reason.trim() ? reason.trim() : 'Usuário desativado'
      }
    });

    return res.json(serializeUser(deactivatedUser as UserRecord));
  } catch (error) {
    console.error('Erro ao desativar usuário:', error);
    return res.status(500).json({ error: 'Erro ao desativar (verifique se o ID existe).' });
  }
});

app.use(['/users', '/api/users'], usersRouter);

if (require.main === module) {
  const PORT = 3001;
  app.listen(PORT, () => {
    console.log(`Serviço de Usuários inicializado na porta ${PORT}`);
  });
}

export default app;