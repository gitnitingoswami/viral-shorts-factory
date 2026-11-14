import type { AuthTokenResponse, UserDto, UserRole } from '@vsf/contracts';

export function makeUser(role: UserRole = 'owner'): UserDto {
  return { id: `u-${role}`, email: `${role}@example.test`, role, createdAt: '2026-01-01T00:00:00.000Z' };
}

export function makeTokenResponse(token = 'access-1', role: UserRole = 'owner'): AuthTokenResponse {
  return { accessToken: token, expiresIn: 900, user: makeUser(role) };
}
