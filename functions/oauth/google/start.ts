import { Env } from "../../../lib/session";

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const url = new URL(request.url);
  const redirectUri = new URL('/oauth/google/callback', url.origin).toString();

  const state = crypto.randomUUID();
  const setState = `oauth_state=${state}; HttpOnly; Secure; Path=/; Max-Age=600; SameSite=Lax`;

  const scope = [
    'openid','email','profile',
    'https://www.googleapis.com/auth/tasks.readonly',
    'https://www.googleapis.com/auth/calendar'
  ].join(' ');

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', scope);
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');
  authUrl.searchParams.set('include_granted_scopes', 'true');
  authUrl.searchParams.set('state', state);

  return new Response(null, {
    status: 302,
    headers: { Location: authUrl.toString(), 'Set-Cookie': setState }
  });
};
