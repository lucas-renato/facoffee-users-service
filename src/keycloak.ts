// src/keycloak.ts

async function getAdminAccessToken(): Promise<string> {
  const tokenResponse = await fetch('http://localhost:8080/realms/facoffee/protocol/openid-connect/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: 'facoffee-private',
      client_secret: 'facoffee-private-secret'
    })
  });

  const tokenData = await tokenResponse.json();
  const accessToken = tokenData.access_token;

  if (!accessToken) {
    throw new Error('Falha ao obter token de administração do Keycloak');
  }

  return accessToken;
}

export async function createKeycloakUser(name: string, email: string) {
  const accessToken = await getAdminAccessToken();

  const createUserResponse = await fetch('http://localhost:8080/admin/realms/facoffee/users', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      username: email,
      email: email,
      firstName: name,
      enabled: true,
      credentials: [
        {
          type: 'password',
          value: 'mudar123',
          temporary: true
        }
      ]
    })
  });

  if (!createUserResponse.ok && createUserResponse.status !== 409) {
    const errorText = await createUserResponse.text();
    throw new Error(`Erro no Keycloak: ${createUserResponse.status} - ${errorText}`);
  }

  return true;
}