// src/rabbitmq.ts
import amqp, { type Channel, type Connection } from 'amqplib';

let connection: Connection | null = null;
let channel: Channel | null = null;

async function getChannel(): Promise<Channel> {
  if (channel) {
    return channel;
  }

  if (!connection) {
    connection = await amqp.connect('amqp://facoffee:facoffee@localhost');
  }

  channel = await connection.createChannel();
  return channel;
}

export async function sendToQueue(queueName: string, data: unknown): Promise<void> {
  try {
    const activeChannel = await getChannel();
    await activeChannel.assertQueue(queueName, { durable: true });
    activeChannel.sendToQueue(queueName, Buffer.from(JSON.stringify(data)), { persistent: true });
    console.log(`[RABBITMQ] Mensagem enviada para a fila '${queueName}'!`);
  } catch (error) {
    channel = null;
    connection = null;
    console.error('[RABBITMQ] Falha ao enviar mensagem:', error);
    throw error;
  }
}

export async function closeRabbitMq(): Promise<void> {
  if (channel) {
    await channel.close();
    channel = null;
  }

  if (connection) {
    await connection.close();
    connection = null;
  }
}