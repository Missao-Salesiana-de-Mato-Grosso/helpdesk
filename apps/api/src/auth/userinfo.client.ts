import { z } from 'zod';
import {
  type UserinfoClient,
  type UserinfoProfile,
  UserinfoUnavailableError,
} from './auth.tokens.js';

const userinfoSchema = z.object({
  email: z.email(),
  email_verified: z.boolean().optional(),
  name: z.string().optional(),
  given_name: z.string().optional(),
  family_name: z.string().optional(),
  preferred_username: z.string().optional(),
});

/** `GET {issuer}/oidc/v1/userinfo` com o próprio access token. O access token não traz nome nem e-mail. */
export class HttpUserinfoClient implements UserinfoClient {
  constructor(
    private readonly issuer: string,
    private readonly timeoutMs = 5000,
  ) {}

  async fetchProfile(accessToken: string): Promise<UserinfoProfile> {
    let response: Response;
    try {
      response = await fetch(`${this.issuer}/oidc/v1/userinfo`, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new UserinfoUnavailableError('userinfo inacessível', { cause: error });
    }
    if (!response.ok) {
      throw new UserinfoUnavailableError(`userinfo respondeu ${response.status}`);
    }
    const parsed = userinfoSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) {
      throw new UserinfoUnavailableError('userinfo sem e-mail válido');
    }
    const { email, email_verified, name, given_name, family_name, preferred_username } =
      parsed.data;
    const fullName =
      name?.trim() ||
      [given_name, family_name].filter(Boolean).join(' ').trim() ||
      preferred_username ||
      email;
    return { email, name: fullName, emailVerified: email_verified === true };
  }
}
