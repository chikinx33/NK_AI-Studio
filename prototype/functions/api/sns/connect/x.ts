import { startMetaOAuth } from '../../_shared/meta-oauth.js';
export const onRequestGet = ({ request, env }) => startMetaOAuth(request, env, 'x');
