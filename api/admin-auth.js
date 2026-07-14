// ORACLE Admin Auth
//
// FIX (security): the admin panel used to unlock purely client-side —
// `if(params.get('admin') === 'doom') $('adminPanel')?.classList.add('open');`
// The "password" ('doom') was a literal string sitting in app.js, visible to
// anyone who opens dev tools or views source. That's not authentication,
// it's an easily-discoverable URL parameter. This endpoint moves the actual
// secret to a server-side environment variable (ADMIN_TOKEN) that never
// ships to the browser. The frontend now must ask this endpoint "is this
// token valid?" and only unlocks the panel if the server says yes.
//
// FIX (this pass): this endpoint previously read the token from a GET query
// string (`?token=...`), which meant the secret would land in Vercel access
// logs and browser history in plaintext. app.js now actually calls this
// endpoint (it didn't before — see app.js), so this is no longer dead code
// and it's worth closing that hole: the token is now read from a POST body
// instead.
//
// This is still a simple shared-secret check, not full auth (no sessions,
// no per-user accounts, no rate limiting on guesses). It is a meaningful
// improvement over a hardcoded client-side string, but if the admin panel
// ever does anything more sensitive than triggering a refresh or generating
// draft social posts, it should be upgraded to real authentication
// (e.g. a signed session cookie issued after checking credentials against
// a proper user store) before going further.
export default async function handler(req, res){
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  if(req.method !== 'POST'){
    return res.status(405).json({ ok:false, reason:'method_not_allowed' });
  }

  const expected = process.env.ADMIN_TOKEN;

  // req.body may already be a parsed object (Vercel's default body parser)
  // or a raw string, depending on runtime config — handle both defensively.
  let body = req.body;
  if(typeof body === 'string'){
    try{ body = JSON.parse(body); }catch{ body = {}; }
  }
  const provided = body?.token || '';

  // If no ADMIN_TOKEN is configured on the server, the admin panel is
  // disabled entirely rather than falling back to some default/guessable
  // value. This avoids the classic "forgot to set the env var in prod"
  // trap where a feature meant to be gated ends up open to everyone.
  if(!expected){
    return res.status(200).json({ ok:false, reason:'admin_disabled' });
  }

  if(provided && provided === expected){
    return res.status(200).json({ ok:true });
  }

  return res.status(401).json({ ok:false, reason:'invalid_token' });
}
