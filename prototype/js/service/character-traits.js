; (function () {
  /**
   * 캐릭터 텍스트 속성의 단일 원천.
   *
   * 예전에는 5칸이었다: description · fixedTraits · bannedTraits · negativePrompt · styleGuide.
   * 실제로는 이렇게 갈라져 있었다.
   *   - description 과 fixedTraits 는 같은 말을 두 번 적는 칸이었고, 둘을 이어붙인 뒤
   *     180자에서 잘라 쓰는 바람에 뒤쪽(styleGuide)이 통째로 날아가곤 했다.
   *   - bannedTraits 와 negativePrompt 는 이미지에서 결국 같은 프롬프트에 부정문 두 줄
   *     ("Avoid: …" 과 "Do not include: …")로 합류했다. 심지어 언어도 서로 달랐다.
   *   - 정작 ip/analyze 의 지시문은 "이미지 모델은 부정문을 약하게 처리하니 형태는 긍정문으로
   *     쓰라"고 말하고 있었다. 시스템이 자기 원칙과 어긋나 있었다.
   *   - styleGuide 는 캐릭터마다 화풍을 따로 두게 해, 오히려 한 화면에서 그림체가 갈릴 수 있었다.
   *
   * 그래서 2칸으로 줄였다.
   *   description    = 캐릭터 생김새. 긍정문만. (구 description + fixedTraits + styleGuide)
   *   negativePrompt = 안 나오게 할 것. 영어 키워드. (구 negativePrompt + bannedTraits)
   *
   * 저장 키는 그대로 두고 읽을 때 합친다. 기존 사용자 데이터가 사라지지 않게 하려는 것이고,
   * 옛 형식이 언제 들어와도(오래된 프로젝트·다른 기기 캐시) 같은 결과가 나오게 하려는 것이다.
   */
  var NK = window.NK || (window.NK = {});
  var service = NK.service || (NK.service = {});
  var traits = service.characterTraits || (service.characterTraits = {});

  function normText(v) { return String(v == null ? '' : v).replace(/[<>]/g, '').trim(); }

  /** 문자열(쉼표·줄바꿈 구분) 또는 배열 → 구(phrase) 배열. */
  function toPhrases(value) {
    if (Array.isArray(value)) {
      return value.map(normText).filter(Boolean);
    }
    return normText(value).split(/[,\n]/).map(normText).filter(Boolean);
  }

  /**
   * 비교용 키. 구두점·공백을 지워 "짧은 팔," 과 "짧은 팔" 을 같은 것으로 본다.
   * 표기가 다르면(예: "파란 큐브형 몸" vs "파란 라운드 큐브 몸체") 남는다 — 뜻까지
   * 맞춰보진 않는다. 확실히 같은 것만 지우고 애매하면 살리는 쪽이 안전하다.
   */
  function dedupeKey(phrase) {
    return String(phrase || '').toLowerCase().replace(/[\s.,·・:;!?()[\]{}"'`-]/g, '');
  }

  /** 여러 소스의 구를 순서대로 합치고 중복만 걷어낸다. */
  function mergePhrases(sources) {
    var out = [];
    var seen = Object.create(null);
    (sources || []).forEach(function (src) {
      toPhrases(src).forEach(function (phrase) {
        var key = dedupeKey(phrase);
        if (!key || seen[key]) return;
        seen[key] = true;
        out.push(phrase);
      });
    });
    return out;
  }

  /**
   * 생김새 한 칸. 구 description + fixedTraits + styleGuide 를 합친다.
   * 이미 새 형식(2칸)으로 저장된 데이터는 description 만 있으므로 그대로 통과한다.
   */
  traits.mergeAppearance = function (src) {
    var s = src && typeof src === 'object' ? src : {};
    return mergePhrases([s.description, s.fixedTraits, s.styleGuide]).join(', ');
  };

  /** 네거티브 한 칸. 구 negativePrompt + bannedTraits 를 합친다. */
  traits.mergeNegative = function (src) {
    var s = src && typeof src === 'object' ? src : {};
    return mergePhrases([s.negativePrompt, s.bannedTraits]).join(', ');
  };

  /**
   * 캐릭터 객체에서 텍스트 속성만 새 형식으로 정리해 돌려준다.
   * 옛 키(fixedTraits·bannedTraits·styleGuide)는 빈 값으로 남겨 둔다 —
   * 지우지 않는 이유는, 아직 그 키를 읽는 코드가 있어도 조용히 무시되게 하기 위해서다.
   */
  traits.normalizeTextProps = function (src) {
    return {
      description: traits.mergeAppearance(src),
      negativePrompt: traits.mergeNegative(src),
      fixedTraits: [],
      bannedTraits: [],
      styleGuide: ''
    };
  };

  traits.toPhrases = toPhrases;
  traits.mergePhrases = mergePhrases;
})();
