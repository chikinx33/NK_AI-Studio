;(function () {
  var NK = window.NK || (window.NK = {});
  var lang = localStorage.getItem('nk_lang') === 'en' ? 'en' : 'ko';
  var params = new URLSearchParams(location.hash.slice(1));
  // 이전 연결 프로그램이 여는 #connector= 주소도 계속 받는다.
  var hashTokenHash = params.get('connector') || '';
  var hashEmail = params.get('email') || '';
  var hashPlan = params.get('plan') || '';
  // Fragment carries only a token hash, never an OpenAI or worker credential.
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  // 이 PC에서 실행 중인 연결 프로그램(scripts/nk-codex-images.cjs)의 고정 주소.
  var LOCAL = 'http://127.0.0.1:47831';
  var text = function (ko, en) { return lang === 'en' ? en : ko; };
  var set = function (id, ko, en) { document.getElementById(id).textContent = text(ko, en); };
  var $ = function (id) { return document.getElementById(id); };
  var status = $('connect-status');
  var approve = $('connect-approve');
  var disconnect = $('connect-disconnect');
  var user = function () { return String(localStorage.getItem('nk_login_user') || ''); };
  var originalUser = user();
  var busy = false;
  var server = null;
  var serverError = '';
  var local = null;
  var localKey = '';
  var loginPending = false;
  var sawOffline = false;
  var closeScheduled = false;
  var embedded = document.documentElement.classList.contains('is-embed') && window.parent !== window;
  set('connect-title', '내 ChatGPT 구독으로 이미지 생성', 'Generate images with my ChatGPT subscription');
  set('connect-description', '최초 연결 후 NKStudio의 생성 버튼으로 이미지를 만들고 자동 저장할 수 있습니다.', 'After setup, generate and automatically save images with one button in NKStudio.');
  set('install-step-one', '연결 프로그램을 내려받아 압축을 푼 뒤 Start-NKStudio-Images.cmd를 실행해 주세요.', 'Download and extract the connector, then run Start-NKStudio-Images.cmd.');
  set('install-step-two', '실행하면 이 화면에 ChatGPT 로그인 버튼이 나타납니다. 본인 구독 계정으로 로그인해 주세요.', 'A ChatGPT sign-in button appears here once it runs. Sign in with your own subscription.');
  set('install-step-three', '‘이 계정에 연결’을 눌러 현재 계정에 연결해 주세요.', 'Choose Connect this account to finish.');
  set('connect-download', 'Windows 연결 프로그램 다운로드', 'Download Windows connector');
  set('connect-login-hint', '연결 프로그램이 실행 중입니다. 본인 ChatGPT 구독 계정으로 로그인해 주세요. 로그인은 보안상 ChatGPT 창에서 한 번만 진행되고, 끝나면 이 화면이 자동으로 이어집니다.', 'The connector is running. Sign in with your own ChatGPT subscription. For security, sign-in happens once in a ChatGPT window, then this dialog continues automatically.');
  set('connect-login-button', 'ChatGPT로 로그인', 'Sign in with ChatGPT');
  set('connect-consent', '이 PC의 ChatGPT 계정으로 현재 NKStudio 계정의 이미지 생성 요청을 처리합니다. 생성한 이미지는 NKStudio 작업에 자동 저장됩니다.', 'This PC will process image requests for the current NKStudio account using its ChatGPT account. Images will save to your NKStudio work automatically.');
  set('connect-approve', '이 계정에 연결', 'Connect this account');
  set('connect-limits', '연결 프로그램이 실행 중인 PC에서 생성합니다. ChatGPT 구독 한도를 사용하며, 한도 초과·인증 오류 시 다른 계정이나 API로 전환하지 않습니다. 연결은 30일 뒤 다시 확인합니다.', 'Generation runs on a PC with the connector running and uses ChatGPT subscription limits. Quota or authentication errors never switch to another account or API. Reconnect after 30 days.');
  set('connect-disconnect', '연결 해제', 'Disconnect');
  set('connect-switch-account', 'ChatGPT 계정 변경', 'Change ChatGPT account');
  // 연결 프로그램 메시지는 '한국어 / English' 한 줄이다.
  var localMessage = function (value) {
    var parts = String(value || '').split(' / ');
    return lang === 'en' && parts[1] ? parts[1] : parts[0];
  };
  function pairingHash() {
    if (/^[a-f0-9]{64}$/.test(hashTokenHash)) return hashTokenHash;
    return local && local.signedIn && /^[a-f0-9]{64}$/.test(local.tokenHash || '') ? local.tokenHash : '';
  }
  function render() {
    // 이 PC의 연결 프로그램이 로그아웃 상태면(계정 변경 중) 서버의 이전 '연결 정상'보다 로그인 단계를 먼저 보여 준다.
    var online = !!(server && server.online) && !(local && local.ready && !local.signedIn);
    var chatgpt = online ? server.email + ' · ' + server.plan
      : local && local.signedIn ? local.email + ' · ' + local.plan
        : hashEmail ? hashEmail + ' · ' + hashPlan : '';
    $('connect-account').textContent = text('현재 NKStudio 계정: ', 'Current NKStudio account: ') + (originalUser || text('로그인 필요', 'Sign-in required')) + (chatgpt ? '\nChatGPT: ' + chatgpt : '');
    var confirmStep = !online && !!pairingHash();
    var loginStep = !online && !confirmStep && !!local;
    $('connect-confirm').hidden = !confirmStep;
    $('connect-login').hidden = !loginStep;
    $('connect-install').hidden = online || confirmStep || loginStep;
    $('connect-login-button').disabled = busy || !(local && local.ready);
    disconnect.hidden = !(server && server.configured);
    $('connect-switch-account').hidden = !(local && local.signedIn);
    $('connect-switch-account').disabled = busy;
    if (serverError) { status.textContent = serverError; return; }
    if (online) status.textContent = text('연결 정상 · ', 'Connected · ') + server.email + ' · ' + server.plan;
    else if (confirmStep) status.textContent = text('ChatGPT 로그인 완료 · 이 계정에 연결해 주세요.', 'Signed in to ChatGPT. Connect this account.');
    else if (loginStep) status.textContent = loginPending ? text('ChatGPT 창에서 로그인을 마쳐 주세요.', 'Finish signing in in the ChatGPT window.') : localMessage(local.message);
    else if (server && server.configured) status.textContent = text('등록됨 · 연결 프로그램을 실행해 주세요.', 'Registered. Start your connector on the PC.');
    else if (server) status.textContent = text('아직 연결되지 않았습니다.', 'Not connected yet.');
  }
  async function refresh() {
    if (busy) return;
    try {
      var result = await NK.api.codexImageRequest();
      if (user() !== originalUser) throw new Error('account_changed');
      server = result; serverError = '';
      if (!server.online) sawOffline = true;
      // 모달에서 연결을 마친 순간(연결 안 됨 → 연결 정상)에만 '연결 정상'을 잠깐 보여 준 뒤 모달을 닫는다.
      // 이미 연결된 상태로 연 모달은 연결 해제를 할 수 있게 그대로 둔다.
      else if (sawOffline && embedded && !closeScheduled) {
        closeScheduled = true;
        setTimeout(function () { window.parent.postMessage({ type: 'nk-codex-connect-close' }, location.origin); }, 1500);
      }
    } catch (error) {
      serverError = !localStorage.getItem('nk_auth_token')
        ? text('NKStudio에 로그인한 뒤 다시 연결해 주세요.', 'Sign in to NKStudio, then connect again.')
        : text('연결 확인 실패: ', 'Connection check failed: ') + error.message;
    }
    render();
  }
  // 이 PC의 연결 프로그램 확인은 로컬 요청이라 DB를 쓰지 않는다. 서버 확인은 상태가 바뀔 때만 한다.
  async function probeLocal() {
    var next = null;
    try {
      var response = await fetch(LOCAL + '/status', { cache: 'no-store', signal: AbortSignal.timeout(2500) });
      if (response.ok) next = await response.json();
    } catch (_) { }
    local = next;
    if (local && local.signedIn) loginPending = false;
    if (local && local.ready && !local.signedIn) sawOffline = true;
    var key = local ? [local.signedIn, local.paired].join(':') : 'off';
    if (key !== localKey) { localKey = key; refresh(); } else render();
  }
  $('connect-login-button').addEventListener('click', async function () {
    if (busy) return;
    // 로그인 창은 클릭 순간에 열어야 팝업 차단에 걸리지 않는다. OpenAI 로그인 화면은 모달 안에 넣을 수 없다.
    var win = window.open('about:blank', '_blank');
    busy = true; render();
    try {
      var response = await fetch(LOCAL + '/login', { method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(30000) });
      var data = await response.json();
      if (data.signedIn) { if (win) win.close(); }
      else if (!data.authUrl) throw new Error(data.error || 'codex_login_unavailable');
      else if (win) { win.opener = null; win.location.href = data.authUrl; loginPending = true; }
      else throw new Error('popup_blocked');
    } catch (error) {
      if (win) win.close();
      serverError = error.message === 'popup_blocked'
        ? text('팝업이 차단되었습니다. 이 사이트의 팝업을 허용한 뒤 다시 눌러 주세요.', 'The popup was blocked. Allow popups for this site and try again.')
        : text('로그인을 시작하지 못했습니다: ', 'Could not start sign-in: ') + error.message;
      setTimeout(function () { serverError = ''; render(); }, 6000);
    } finally { busy = false; render(); }
  });
  approve.addEventListener('click', async function () {
    if (busy) return;
    if (user() !== originalUser || !originalUser) { status.textContent = text('현재 계정을 다시 확인해 주세요.', 'Verify the current account again.'); return; }
    var tokenHash = pairingHash();
    if (!tokenHash) return;
    busy = true; approve.disabled = true;
    try {
      await NK.api.codexImageRequest({ operation: 'connect', tokenHash: tokenHash });
      if (user() !== originalUser) throw new Error('account_changed');
      hashTokenHash = '';
      localStorage.setItem((NK.config.KEYS || {}).IMAGE_PROVIDER || 'nk_ai_image_provider', 'chatgpt-subscription');
      busy = false;
      await refresh();
      if (!(server && server.online)) status.textContent = text('등록 완료 · 연결 프로그램의 응답을 확인 중입니다.', 'Registered. Waiting for your connector.');
    } catch (error) { status.textContent = text('연결 실패: ', 'Connection failed: ') + error.message; }
    finally { busy = false; approve.disabled = false; }
  });
  $('connect-switch-account').addEventListener('click', async function () {
    if (busy || !local) return;
    busy = true; render();
    try {
      var response = await fetch(LOCAL + '/logout', { method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(15000) });
      var data = await response.json();
      if (!response.ok) throw new Error(data.error || 'codex_logout_unavailable');
      local = Object.assign({}, local, { signedIn: false, email: '', plan: '', tokenHash: '', paired: false });
      localKey = 'false:false';
      sawOffline = true;
    } catch (error) {
      serverError = error.message === 'connector_busy'
        ? text('이미지 생성 중에는 계정을 바꿀 수 없습니다. 생성이 끝난 뒤 다시 눌러 주세요.', 'You cannot change accounts while an image is generating. Try again when it finishes.')
        : text('계정 변경 실패: ', 'Could not change account: ') + error.message;
      setTimeout(function () { serverError = ''; render(); }, 6000);
    } finally { busy = false; render(); }
  });
  disconnect.addEventListener('click', async function () {
    if (busy || user() !== originalUser) return;
    if (!confirm(text('현재 계정의 ChatGPT 이미지 연결을 해제할까요?', 'Disconnect ChatGPT images for the current account?'))) return;
    busy = true;
    try { await NK.api.codexImageRequest({ operation: 'disconnect' }); }
    catch (error) { status.textContent = error.message; }
    finally { busy = false; refresh(); }
  });
  // 랜딩 모달(iframe) 안에서 열렸을 때: 높이를 부모에 알리고, Esc 로 닫는다.
  if (embedded) {
    var post = function (data) { window.parent.postMessage(data, location.origin); };
    var sendHeight = function () { post({ type: 'nk-codex-connect-height', height: document.documentElement.scrollHeight }); };
    new ResizeObserver(sendHeight).observe(document.body);
    sendHeight();
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') post({ type: 'nk-codex-connect-close' }); });
  }
  render();
  probeLocal();
  setInterval(function () { if (!document.hidden) probeLocal(); }, 3000);
})();
