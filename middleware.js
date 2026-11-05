// Vercel Routing Middleware: puts a password in front of every page and data file.
// The password is "Glitch"; setting DASHBOARD_PASSWORD in Vercel overrides it.
// The browser asks for a username and password; any username works.
import { next } from '@vercel/functions';

export default function middleware(request) {
  const password = process.env.DASHBOARD_PASSWORD || 'Glitch';
  const [scheme, encoded] = (request.headers.get('authorization') || '').split(' ');
  if (scheme === 'Basic' && encoded) {
    const decoded = atob(encoded);
    const given = decoded.slice(decoded.indexOf(':') + 1);
    if (given === password) return next();
  }
  return new Response('Password required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Games Dashboard", charset="UTF-8"' },
  });
}
