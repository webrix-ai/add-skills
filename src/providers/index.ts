// Export types
export type { HostProvider, ProviderMatch, ProviderRegistry, RemoteSkill } from './types.ts';

// Export registry functions
export { registry, registerProvider, findProvider, getProviders } from './registry.ts';

// Export auth utilities for providers that need authenticated fetching
export {
  fetchWithAuth,
  performOAuthFlow,
  parseWWWAuthenticateHeader,
  fetchProtectedResourceMetadata,
  fetchAuthServerMetadata,
  registerOAuthClient,
  exchangeAuthorizationCode,
  getStoredTokens,
  storeTokens,
  clearTokens,
  type OAuthTokens,
  type OAuthChallenge,
  type OAuthProtectedResourceMetadata,
  type OAuthServerMetadata,
  type OAuthClientInfo,
  type FetchWithAuthOptions,
} from './auth.ts';

// Export individual providers
export { MintlifyProvider, mintlifyProvider } from './mintlify.ts';
export { HuggingFaceProvider, huggingFaceProvider } from './huggingface.ts';
export {
  WellKnownProvider,
  wellKnownProvider,
  type WellKnownIndex,
  type WellKnownSkillEntry,
  type WellKnownSkill,
} from './wellknown.ts';
export { ZipProvider, zipProvider, type ZipSkill } from './zip.ts';

// Register all built-in providers
import { registerProvider } from './registry.ts';
import { mintlifyProvider } from './mintlify.ts';
import { huggingFaceProvider } from './huggingface.ts';
import { wellKnownProvider } from './wellknown.ts';
import { zipProvider } from './zip.ts';

registerProvider(mintlifyProvider);
registerProvider(huggingFaceProvider);
registerProvider(zipProvider);
// Note: wellKnownProvider is NOT registered here - it's a fallback provider
// that should only be used explicitly when parsing detects a well-known URL
