import { receiveMetaEvent } from '../../_shared/meta-events.js';
export const onRequestPost = ({ request, env }) => receiveMetaEvent(request, env);
