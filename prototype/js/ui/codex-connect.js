;(function () {
  var NK = window.NK || (window.NK = {});
  var lang = localStorage.getItem('nk_lang') === 'en' ? 'en' : 'ko';
  var params = new URLSearchParams(location.hash.slice(1));
  var tokenHash = params.get('connector') || '';
  var email = params.get('email') || '';
  var plan = params.get('plan') || '';
  // Fragment carries only a token hash, never an OpenAI or worker credential.
  if (location.hash) history.replaceState(null, '', location.pathname);
  var text = function (ko, en) { return lang === 'en' ? en : ko; };
  var set = function (id, ko, en) { document.getElementById(id).textContent = text(ko, en); };
  var status = document.getElementById('connect-status');
  var approve = document.getElementById('connect-approve');
  var disconnect = document.getElementById('connect-disconnect');
  var user = function () { return String(localStorage.getItem('nk_login_user') || ''); };
  var originalUser = user();
  var busy = false;
  set('connect-title', '내 ChatGPT 구독으로 이미지 생성', 'Generate images with my ChatGPT subscription');
  set('connect-description', '최초 연결 후 NKStudio의 생성 버튼으로 이미지를 만들고 자동 저장할 수 있습니다.', 'After setup, generate and automatically save images with one button in NKStudio.');
  set('install-step-one', '연결 프로그램을 내려받아 압축을 푼 뒤 Start-NKStudio-Images.cmd를 실행해 주세요.', 'Download and extract the connector, then run Start-NKStudio-Images.cmd.');
  set('install-step-two', '열리는 화면에서 본인 ChatGPT 구독 계정으로 로그인해 주세요.', 'Sign in with your own ChatGPT subscription in the setup page.');
  set('install-step-three', '‘NKStudio 계정에 연결’을 눌러 현재 계정에 연결해 주세요.', 'Choose Connect NKStudio to connect the current account.');
  set('connect-download', 'Windows 연결 프로그램 다운로드', 'Download Windows connector');
  set('connect-consent', '이 PC의 ChatGPT 계정으로 현재 NKStudio 계정의 이미지 생성 요청을 처리합니다. 생성한 이미지는 NKStudio 작업에 자동 저장됩니다.', 'This PC will process image requests for the current NKStudio account using its ChatGPT account. Images will save to your NKStudio work automatically.');
  set('connect-approve', '이 계정에 연결', 'Connect this account');
  set('connect-limits', '연결 프로그램이 실행 중인 PC에서 생성합니다. ChatGPT 구독 한도를 사용하며, 한도 초과·인증 오류 시 다른 계정이나 API로 전환하지 않습니다. 연결은 30일 뒤 다시 확인합니다.', 'Generation runs on a PC with the connector running and uses ChatGPT subscription limits. Quota or authentication errors never switch to another account or API. Reconnect after 30 days.');
  set('connect-open-images', '이미지 생성 열기', 'Open image generation');
  set('connect-refresh', '연결 확인', 'Check connection');
  set('connect-disconnect', '연결 해제', 'Disconnect');
  document.getElementById('connect-account').textContent = text('현재 NKStudio 계정: ', 'Current NKStudio account: ') + (originalUser || text('로그인 필요', 'Sign-in required')) + (email ? '\nChatGPT: ' + email + ' · ' + plan : '');
  var pairing = /^[a-f0-9]{64}$/.test(tokenHash);
  document.getElementById('connect-confirm').hidden = !pairing;
  document.getElementById('connect-install').hidden = pairing;
  async function refresh() {
    if (busy) return;
    try {
      var result = await NK.api.codexImageRequest();
      if (user() !== originalUser) throw new Error('account_changed');
      disconnect.hidden = !result.configured;
      status.textContent = result.online
        ? text('연결 정상 · ', 'Connected · ') + result.email + ' · ' + result.plan
        : result.configured ? text('등록됨 · 연결 프로그램을 실행해 주세요.', 'Registered. Start your connector on the PC.')
          : text('아직 연결되지 않았습니다.', 'Not connected yet.');
      if (result.online) document.getElementById('connect-account').textContent = 'NKStudio: ' + originalUser + '\nChatGPT: ' + result.email + ' · ' + result.plan;
    } catch (error) {
      status.textContent = text('연결 확인 실패: ', 'Connection check failed: ') + error.message;
      if (!localStorage.getItem('nk_auth_token')) status.textContent = text('NKStudio에 로그인한 뒤 연결 프로그램 화면에서 다시 연결해 주세요.', 'Sign in to NKStudio, then reconnect from the connector setup page.');
    }
  }
  approve.addEventListener('click', async function () {
    if (busy) return;
    if (user() !== originalUser || !originalUser) { status.textContent = text('현재 계정을 다시 확인해 주세요.', 'Verify the current account again.'); return; }
    busy = true; approve.disabled = true;
    try {
      await NK.api.codexImageRequest({ operation: 'connect', tokenHash: tokenHash });
      if (user() !== originalUser) throw new Error('account_changed');
      document.getElementById('connect-confirm').hidden = true;
      localStorage.setItem((NK.config.KEYS || {}).IMAGE_PROVIDER || 'nk_ai_image_provider', 'chatgpt-subscription');
      status.textContent = text('등록 완료 · 연결 프로그램의 응답을 확인 중입니다.', 'Registered. Waiting for your connector.');
    } catch (error) { status.textContent = text('연결 실패: ', 'Connection failed: ') + error.message; approve.disabled = false; }
    finally { busy = false; }
  });
  disconnect.addEventListener('click', async function () {
    if (busy || user() !== originalUser) return;
    if (!confirm(text('현재 계정의 ChatGPT 이미지 연결을 해제할까요?', 'Disconnect ChatGPT images for the current account?'))) return;
    busy = true;
    try { await NK.api.codexImageRequest({ operation: 'disconnect' }); }
    catch (error) { status.textContent = error.message; }
    finally { busy = false; refresh(); }
  });
  document.getElementById('connect-refresh').addEventListener('click', refresh);
  refresh();
  setInterval(refresh, 8000);
})();
