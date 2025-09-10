export const onRequestGet: PagesFunction = async ({ env }) => {
  const info = {
    hasDB: !!(env as any).DB,
    hasGOOGLE_CLIENT_ID: !!(env as any).GOOGLE_CLIENT_ID,
    hasGOOGLE_CLIENT_SECRET: !!(env as any).GOOGLE_CLIENT_SECRET,
    hasMASTER_ENCRYPTION_KEY: !!(env as any).MASTER_ENCRYPTION_KEY,
    hasSESSION_SECRET: !!(env as any).SESSION_SECRET
  };
  return new Response(JSON.stringify(info, null, 2), {
    headers: { 'Content-Type': 'application/json' }
  });
};