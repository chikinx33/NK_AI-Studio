import { completeMetaOAuth } from '../_shared/meta-oauth.js';
export const onRequestPost = ({ request, env }) => completeMetaOAuth(request, env);
