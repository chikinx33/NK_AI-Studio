import { receiveMetaOAuth } from '../../_shared/meta-oauth.js';
export const onRequestGet = ({ request, env }) => receiveMetaOAuth(request, env, 'instagram');
