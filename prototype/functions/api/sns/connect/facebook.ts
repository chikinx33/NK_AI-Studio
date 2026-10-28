import { startMetaOAuth } from '../../_shared/meta-oauth.js';
// 서명 state·일회성 티켓 흐름(meta-oauth.js). 페이지 지정(?page=)은 서버 티켓에만 저장된다.
export const onRequestGet = ({ request, env }) => startMetaOAuth(request, env, 'facebook');
