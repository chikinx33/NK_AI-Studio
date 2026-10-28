import { receiveMetaOAuth } from '../../api/_shared/meta-oauth.js';
export const onRequestGet = ({ request, env }) => receiveMetaOAuth(request, env, 'threads');
