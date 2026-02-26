/**
 * OAuth authentication module for protected skill providers.
 *
 * Implements OAuth 2.0 with PKCE (RFC 7636) for secure authentication
 * when fetching skills from protected endpoints.
 *
 * Supports:
 * - Protected Resource Metadata (RFC 8707)
 * - Authorization Server Metadata discovery
 * - Dynamic Client Registration (RFC 7591)
 * - PKCE challenge/verifier flow
 */

/**
 * OAuth token storage.
 */
export interface OAuthTokens {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

/**
 * OAuth metadata from WWW-Authenticate header.
 */
export interface OAuthChallenge {
  error?: string;
  error_description?: string;
  resource_metadata?: string;
}

/**
 * OAuth Protected Resource Metadata (RFC 8707).
 */
export interface OAuthProtectedResourceMetadata {
  resource: string;
  authorization_servers?: string[];
  bearer_methods_supported?: string[];
  resource_documentation?: string;
}

/**
 * OAuth Authorization Server Metadata.
 */
export interface OAuthServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
  response_types_supported?: string[];
  grant_types_supported?: string[];
  code_challenge_methods_supported?: string[];
  token_endpoint_auth_methods_supported?: string[];
}

/**
 * OAuth Client Information.
 */
export interface OAuthClientInfo {
  client_id: string;
  client_secret?: string;
  redirect_uris?: string[];
}

/**
 * Options for fetchWithAuth.
 */
export interface FetchWithAuthOptions extends RequestInit {
  /** Timeout in milliseconds (default: 60000) */
  timeout?: number;
}

/**
 * Persisted auth data structure.
 */
interface PersistedAuthData {
  tokens: Record<string, OAuthTokens>;
  clients: Record<string, OAuthClientInfo>;
}

// In-memory cache (loaded from disk on first access)
let tokenStorage: Map<string, OAuthTokens> | null = null;
let clientStorage: Map<string, OAuthClientInfo> | null = null;

/**
 * Get the path to the auth storage file.
 */
async function getAuthFilePath(): Promise<string> {
  const os = await import('os');
  const path = await import('path');
  return path.join(os.homedir(), '.skills-auth');
}

/**
 * Load auth data from disk.
 */
async function loadAuthData(): Promise<void> {
  if (tokenStorage !== null && clientStorage !== null) {
    return; // Already loaded
  }

  tokenStorage = new Map();
  clientStorage = new Map();

  try {
    const fs = await import('fs/promises');
    const authPath = await getAuthFilePath();
    const data = await fs.readFile(authPath, 'utf-8');
    const parsed: PersistedAuthData = JSON.parse(data);

    if (parsed.tokens) {
      for (const [key, value] of Object.entries(parsed.tokens)) {
        tokenStorage.set(key, value);
      }
    }
    if (parsed.clients) {
      for (const [key, value] of Object.entries(parsed.clients)) {
        clientStorage.set(key, value);
      }
    }
  } catch {
    // File doesn't exist or is invalid, start fresh
  }
}

/**
 * Save auth data to disk.
 */
async function saveAuthData(): Promise<void> {
  if (!tokenStorage || !clientStorage) {
    return;
  }

  try {
    const fs = await import('fs/promises');
    const authPath = await getAuthFilePath();

    const data: PersistedAuthData = {
      tokens: Object.fromEntries(tokenStorage),
      clients: Object.fromEntries(clientStorage),
    };

    await fs.writeFile(authPath, JSON.stringify(data, null, 2), { mode: 0o600 });
  } catch {
    // Ignore save errors
  }
}

/**
 * Get the token storage map (loading from disk if needed).
 */
async function getTokenStorage(): Promise<Map<string, OAuthTokens>> {
  await loadAuthData();
  return tokenStorage!;
}

/**
 * Get the client storage map (loading from disk if needed).
 */
async function getClientStorage(): Promise<Map<string, OAuthClientInfo>> {
  await loadAuthData();
  return clientStorage!;
}

/**
 * Generate a cryptographically secure random string for PKCE code verifier.
 */
function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Generate PKCE code challenge from verifier using SHA-256.
 */
async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  // Base64url encoding without padding
  const base64 = btoa(String.fromCharCode(...hashArray))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return base64;
}

/**
 * Parse WWW-Authenticate header to extract OAuth challenge details.
 */
export function parseWWWAuthenticateHeader(header: string): OAuthChallenge {
  const challenge: OAuthChallenge = {};

  // Extract Bearer challenge parameters
  const bearerMatch = header.match(/Bearer\s+(.*)/i);
  if (!bearerMatch) {
    return challenge;
  }

  const params = bearerMatch[1];
  // Parse key="value" pairs
  const paramRegex = /(\w+)="([^"]*)"/g;
  let match;
  while ((match = paramRegex.exec(params!)) !== null) {
    const [, key, value] = match;
    if (key === 'error') {
      challenge.error = value;
    } else if (key === 'error_description') {
      challenge.error_description = value;
    } else if (key === 'resource_metadata') {
      challenge.resource_metadata = value;
    }
  }

  return challenge;
}

/**
 * Fetch OAuth Protected Resource Metadata.
 */
export async function fetchProtectedResourceMetadata(
  metadataUrl: string
): Promise<OAuthProtectedResourceMetadata | null> {
  try {
    const response = await fetch(metadataUrl, {
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as OAuthProtectedResourceMetadata;
  } catch {
    return null;
  }
}

/**
 * Fetch OAuth Authorization Server Metadata using well-known endpoint.
 */
export async function fetchAuthServerMetadata(
  authServerUrl: string
): Promise<OAuthServerMetadata | null> {
  try {
    const parsed = new URL(authServerUrl);
    const metadataUrl = `${parsed.protocol}//${parsed.host}/.well-known/oauth-authorization-server`;
    const response = await fetch(metadataUrl, {
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as OAuthServerMetadata;
  } catch {
    return null;
  }
}

/**
 * Register a new OAuth client with the authorization server.
 */
export async function registerOAuthClient(
  registrationEndpoint: string,
  redirectUri: string
): Promise<OAuthClientInfo | null> {
  try {
    const clientMetadata = {
      client_name: 'skills-cli',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };

    const response = await fetch(registrationEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(clientMetadata),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return null;
    }

    const clientInfo = (await response.json()) as OAuthClientInfo;
    return clientInfo;
  } catch {
    return null;
  }
}

/**
 * Exchange authorization code for tokens.
 */
export async function exchangeAuthorizationCode(
  tokenEndpoint: string,
  clientId: string,
  code: string,
  codeVerifier: string,
  redirectUri: string
): Promise<OAuthTokens | null> {
  try {
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
    });

    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as OAuthTokens;
  } catch {
    return null;
  }
}

/**
 * Start a local HTTP server to receive the OAuth callback.
 * Returns a promise that resolves with the authorization code.
 */
async function startCallbackServer(port: number): Promise<string> {
  // Dynamic import to avoid issues with bundling
  const http = await import('http');

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url!, `http://localhost:${port}`);
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(`
          <html>
            <body>
              <h1>Authorization Failed</h1>
              <p>Error: ${error}</p>
              <p>You can close this window.</p>
            </body>
          </html>
        `);
        server.close();
        reject(new Error(`OAuth error: ${error}`));
        return;
      }

      if (code) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <html>
            <body>
              <h1>Authorization Successful</h1>
              <p>You can close this window and return to the CLI.</p>
            </body>
          </html>
        `);
        server.close();
        resolve(code);
        return;
      }

      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end('<html><body><h1>Invalid Request</h1></body></html>');
    });

    server.listen(port, '127.0.0.1', () => {
      // Server is listening
    });

    // Timeout after 5 minutes
    setTimeout(
      () => {
        server.close();
        reject(new Error('OAuth callback timeout'));
      },
      5 * 60 * 1000
    );
  });
}

/**
 * Get the command to open a URL in the default browser.
 */
async function getOpenCommand(): Promise<string | null> {
  const platform = process.platform;
  if (platform === 'darwin') {
    return 'open';
  } else if (platform === 'win32') {
    return 'start';
  } else if (platform === 'linux') {
    return 'xdg-open';
  }
  return null;
}

/**
 * Perform full OAuth flow with PKCE.
 *
 * This function:
 * 1. Fetches authorization server metadata
 * 2. Registers a new client (if not already registered)
 * 3. Generates PKCE challenge
 * 4. Opens browser for user authorization
 * 5. Waits for callback with authorization code
 * 6. Exchanges code for tokens
 *
 * @param authServerUrl - The authorization server URL
 * @param resourceUrl - The protected resource URL
 * @returns OAuth tokens or null if the flow failed
 */
export async function performOAuthFlow(
  authServerUrl: string,
  resourceUrl: string
): Promise<OAuthTokens | null> {
  // Fetch auth server metadata
  const authMetadata = await fetchAuthServerMetadata(authServerUrl);
  if (!authMetadata) {
    console.error('Failed to fetch authorization server metadata');
    return null;
  }

  // Check if dynamic registration is supported
  if (!authMetadata.registration_endpoint) {
    console.error('Authorization server does not support dynamic client registration');
    return null;
  }

  const callbackPort = 8085;
  const redirectUri = `http://127.0.0.1:${callbackPort}/callback`;

  // Check if we already have a registered client for this server
  const serverKey = new URL(authServerUrl).origin;
  const clients = await getClientStorage();
  let clientInfo: OAuthClientInfo | undefined = clients.get(serverKey);

  if (!clientInfo || !clientInfo.redirect_uris?.includes(redirectUri)) {
    // Register a new client (fresh or stale-cache recovery)
    const newClientInfo = await registerOAuthClient(
      authMetadata.registration_endpoint,
      redirectUri
    );
    if (!newClientInfo) {
      console.error('Failed to register OAuth client');
      return null;
    }
    clientInfo = newClientInfo;
    clients.set(serverKey, clientInfo);
    await saveAuthData();
  }

  // Generate PKCE challenge
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  // Build authorization URL
  const authUrl = new URL(authMetadata.authorization_endpoint);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', clientInfo.client_id);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('resource', resourceUrl);

  // Open browser for authorization
  console.log('\n🔐 Authentication required. Opening browser for authorization...');
  console.log(`If the browser doesn't open, visit: ${authUrl.toString()}\n`);

  // Open the URL in the default browser
  const open = await getOpenCommand();
  if (open) {
    try {
      const { spawn } = await import('child_process');
      spawn(open, [authUrl.toString()], { detached: true, stdio: 'ignore' }).unref();
    } catch {
      console.log('Could not open browser automatically.');
    }
  }

  // Wait for callback with authorization code
  try {
    const code = await startCallbackServer(callbackPort);

    // Exchange code for tokens
    const tokens = await exchangeAuthorizationCode(
      authMetadata.token_endpoint,
      clientInfo.client_id,
      code,
      codeVerifier,
      redirectUri
    );

    if (tokens) {
      // Store tokens for this resource
      const resourceOrigin = new URL(resourceUrl).origin;
      const tokenMap = await getTokenStorage();
      tokenMap.set(resourceOrigin, tokens);
      await saveAuthData();
    }

    return tokens;
  } catch (error) {
    console.error('OAuth flow failed:', error);
    return null;
  }
}

/**
 * Get stored tokens for a URL origin.
 */
export async function getStoredTokens(url: string): Promise<OAuthTokens | undefined> {
  const origin = new URL(url).origin;
  const tokens = await getTokenStorage();
  return tokens.get(origin);
}

/**
 * Store tokens for a URL origin.
 */
export async function storeTokens(url: string, tokens: OAuthTokens): Promise<void> {
  const origin = new URL(url).origin;
  const tokenMap = await getTokenStorage();
  tokenMap.set(origin, tokens);
  await saveAuthData();
}

/**
 * Clear stored tokens for a URL origin.
 */
export async function clearTokens(url: string): Promise<void> {
  const origin = new URL(url).origin;
  const tokens = await getTokenStorage();
  tokens.delete(origin);
  await saveAuthData();
}

/**
 * Fetch a URL with optional OAuth authentication.
 *
 * If the request returns 401 with a WWW-Authenticate header containing
 * resource_metadata, this function will:
 * 1. Fetch protected resource metadata
 * 2. Discover authorization server
 * 3. Perform OAuth flow with PKCE
 * 4. Retry the request with the obtained access token
 *
 * @param url - The URL to fetch
 * @param options - Fetch options with optional timeout
 * @returns Response from the server
 */
export async function fetchWithAuth(
  url: string,
  options: FetchWithAuthOptions = {}
): Promise<Response> {
  const { timeout = 60000, ...fetchOptions } = options;

  // Check if we have stored tokens for this origin
  const tokens = await getStoredTokens(url);
  if (tokens) {
    fetchOptions.headers = {
      ...fetchOptions.headers,
      Authorization: `Bearer ${tokens.access_token}`,
    };
  }

  let response = await fetch(url, {
    ...fetchOptions,
    signal: AbortSignal.timeout(timeout),
  });

  // If unauthorized, attempt OAuth flow
  if (response.status === 401) {
    const wwwAuthHeader = response.headers.get('WWW-Authenticate');
    if (wwwAuthHeader) {
      const challenge = parseWWWAuthenticateHeader(wwwAuthHeader);

      if (challenge.resource_metadata) {
        // Fetch protected resource metadata
        const resourceMetadata = await fetchProtectedResourceMetadata(challenge.resource_metadata);

        if (resourceMetadata?.authorization_servers?.[0]) {
          // Perform OAuth flow
          const newTokens = await performOAuthFlow(
            resourceMetadata.authorization_servers[0],
            resourceMetadata.resource
          );

          if (newTokens) {
            // Retry request with new token
            fetchOptions.headers = {
              ...fetchOptions.headers,
              Authorization: `Bearer ${newTokens.access_token}`,
            };
            response = await fetch(url, {
              ...fetchOptions,
              signal: AbortSignal.timeout(timeout),
            });
          }
        }
      }
    }
  }

  return response;
}
