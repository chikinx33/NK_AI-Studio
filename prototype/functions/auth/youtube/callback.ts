import { receiveMetaOAuth } from '../../api/_shared/meta-oauth.js';
// 콜백은 일회성 코드만 원래 화면으로 넘긴다. 토큰 교환·저장은 /api/sns/complete 가 원래 로그인 세션과 브라우저 proof 를 확인한 뒤 한다.
export const onRequestGet = ({ request, env }) => receiveMetaOAuth(request, env, 'youtube');
