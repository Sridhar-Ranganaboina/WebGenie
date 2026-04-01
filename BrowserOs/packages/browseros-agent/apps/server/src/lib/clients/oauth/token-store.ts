/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * SQLite storage for OAuth tokens.
 */

import type { Database } from 'bun:sqlite'

export interface StoredOAuthTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
  email?: string
  accountId?: string
}

export interface OAuthStatus {
  authenticated: boolean
  email?: string
  provider: string
}

export class OAuthTokenStore {
  constructor(private readonly db: Database) {}

  upsertTokens(
    browserosId: string,
    provider: string,
    tokens: StoredOAuthTokens,
  ): void {
    const stmt = this.db.prepare(`
      INSERT INTO oauth_tokens (browseros_id, provider, access_token, refresh_token, expires_at, email, account_id, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT (browseros_id, provider) DO UPDATE SET
        access_token = excluded.access_token,
        refresh_token = excluded.refresh_token,
        expires_at = excluded.expires_at,
        email = excluded.email,
        account_id = excluded.account_id,
        updated_at = datetime('now')
    `)
    stmt.run(
      browserosId,
      provider,
      tokens.accessToken,
      tokens.refreshToken,
      tokens.expiresAt,
      tokens.email ?? null,
      tokens.accountId ?? null,
    )
  }

  getTokens(browserosId: string, provider: string): StoredOAuthTokens | null {
    const row = this.db
      .prepare(
        'SELECT access_token, refresh_token, expires_at, email, account_id FROM oauth_tokens WHERE browseros_id = ? AND provider = ?',
      )
      .get(browserosId, provider) as {
      access_token: string
      refresh_token: string
      expires_at: number
      email: string | null
      account_id: string | null
    } | null

    if (!row) return null
    return {
      accessToken: row.access_token,
      refreshToken: row.refresh_token,
      expiresAt: row.expires_at,
      email: row.email ?? undefined,
      accountId: row.account_id ?? undefined,
    }
  }

  deleteTokens(browserosId: string, provider: string): void {
    this.db
      .prepare(
        'DELETE FROM oauth_tokens WHERE browseros_id = ? AND provider = ?',
      )
      .run(browserosId, provider)
  }

  getStatus(browserosId: string, provider: string): OAuthStatus {
    const row = this.db
      .prepare(
        'SELECT email FROM oauth_tokens WHERE browseros_id = ? AND provider = ?',
      )
      .get(browserosId, provider) as { email: string | null } | null

    return {
      authenticated: row !== null,
      email: row?.email ?? undefined,
      provider,
    }
  }
}
